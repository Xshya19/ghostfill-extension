import { motion, AnimatePresence } from 'framer-motion';
import {
  Mail,
  RefreshCw,
  Copy,
  Check,
  LogOut,
  Shield,
  Clock,
  AlertCircle,
  Inbox,
  LogIn,
  ChevronRight,
  Link2,
  X,
  Settings,
  HelpCircle,
  Zap,
  ShieldCheck,
  Hash,
  Info,
  Lock,
  Eye,
  EyeOff,
  Globe2,
} from 'lucide-react';
import React, {
  useEffect,
  useId,
  useRef,
  useState,
  useCallback,
  useMemo,
  Component,
  ErrorInfo,
  ReactNode,
} from 'react';

import ghostLogoImg from '../../../assets/icons/icon128.png';
import notionLogoImg from '../../../assets/icons/notion.png';
import qwenLogoImg from '../../../assets/icons/qwen.png';

import {
  scoreActivationLink,
  SELECT_MIN_QUALITY,
} from '../../../services/extraction/activationLinkGuard';
import {
  extractExplicitVerificationCode,
  isSubjectDomainToken,
} from '../../../services/extraction/explicitCode';
import { getAnchorInfo } from '../../../services/extraction/linkExtractor';
import { extractUrls } from '../../../services/extraction/urlExtractor';
import { hasVerificationCodeEvidence } from '../../../services/extraction/verificationEvidence';
import { storageService } from '../../../services/storageService';
import {
  EmailAccount,
  Email,
  PasswordOptions,
  GeneratedPassword,
  DEFAULT_PASSWORD_OPTIONS,
} from '../../../types';
import { type GmailMessage, type AliasHistoryItem } from '../../../types/email.types';
import { type GeneratePasswordResponse } from '../../../types/message.types';
import { LastOTP, LAST_OTP_MAX_AGE_MS } from '../../../types/storage.types';
import {
  TIMING,
  formatRelativeTime,
  copyToClipboard,
  contentToString,
  isWebUrl,
} from '../../../utils/core';
import {
  getSenderEmail,
  getSenderLabel,
  getSenderLogoDomains,
  getSenderSource,
  parseEmailIdentity,
} from '../../../utils/emailIdentity';
import { createLogger } from '../../../utils/logger';
import { safeSendMessage, safeSendTabMessage } from '../../../utils/messaging';
import { containsRemoteEmailAssets, sanitizeEmailBody } from '../../../utils/sanitization.core';
import { t } from '../../i18n';
import { tweenIn, tweenOut, Button, IconButton } from '../../ui';
import { useStorageSubscription } from '../hooks';
import { GmailLogo } from './ProviderLogos';

export { getSenderSource } from '../../../utils/emailIdentity';

/** Keep background content out of the accessibility tree while a dialog is open. */
function useDialogIsolation(
  isOpen: boolean,
  overlayRef: React.RefObject<HTMLElement | null>
): void {
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const overlay = overlayRef.current;
    const parent = overlay?.parentElement;
    if (!overlay || !parent) {
      return;
    }

    const siblings = Array.from(parent.children).filter(
      (child): child is HTMLElement => child !== overlay
    );
    const previous = siblings.map((sibling) => ({
      sibling,
      inert: sibling.inert,
      ariaHidden: sibling.getAttribute('aria-hidden'),
    }));
    siblings.forEach((sibling) => {
      sibling.inert = true;
      sibling.setAttribute('aria-hidden', 'true');
    });

    return () => {
      previous.forEach(({ sibling, inert, ariaHidden }) => {
        sibling.inert = inert;
        if (ariaHidden === null) {
          sibling.removeAttribute('aria-hidden');
        } else {
          sibling.setAttribute('aria-hidden', ariaHidden);
        }
      });
    };
  }, [isOpen, overlayRef]);
}

// --- AccountCard.tsx ---
// NOTE: Gmail is the only real-mail provider. Zoho/Outlook were removed
// from the UI (backend services + validation stay for compat, but nothing
// sends those actions anymore).
export interface AccountCardProps {
  readonly preferredEmailType: 'disposable' | 'real' | 'gmail' | 'zoho' | 'microsoft';
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
}) => {
  const isReal = preferredEmailType !== 'disposable';

  // 1. Gmail not connected
  if (isReal && !gmailConnected) {
    return (
      <div className="hub-gmail-not-connected">
        <GmailLogo size={44} className="hub-gmail-logo-img" />
        <span className="hub-gmail-title">Connect Gmail</span>
        <span className="hub-gmail-desc">
          Create site-specific aliases and sync OTP emails from your Gmail account.
        </span>
        <button
          type="button"
          onClick={() => {
            void onGmailSignIn();
          }}
          className="hub-gmail-connect-btn"
          disabled={gmailSigningIn}
        >
          {gmailSigningIn ? (
            <span>
              <RefreshCw size={14} className="spin" /> Connecting…
            </span>
          ) : (
            <span>Connect Gmail</span>
          )}
        </button>
      </div>
    );
  }

  const currentOriginalBase = gmailBase;

  const currentDisconnectHandler = onSignOut;

  const providerLabel = !isReal ? t('emailLabel') : 'Gmail Alias';
  const isDisposableExpired =
    !isReal && typeof emailAccount?.expiresAt === 'number' && Date.now() >= emailAccount.expiresAt;

  return (
    <div className="identity-row">
      <div className="identity-icon">
        {isReal ? <GmailLogo size={18} /> : <Mail size={18} className="icon-premium" />}
      </div>
      <div className="identity-content">
        <div className="identity-label-group">
          <span className="identity-label">{providerLabel}</span>
          {!isReal && (
            <CountdownTimer
              expiresAt={emailAccount?.expiresAt}
              expiredLabel={t('expiredLabel') || 'Expired'}
            />
          )}
        </div>
        {(() => {
          const hasAddress = isReal
            ? Boolean(activeEmailAddress)
            : Boolean(emailAccount?.fullEmail);
          const rawEmail = isReal
            ? activeEmailAddress || 'Connected'
            : emailAccount?.fullEmail ||
              (isGeneratingEmail ? t('syncingIdentity') : t('noEmailAddressYet'));
          const atIndex = rawEmail.indexOf('@');
          const hasAt = atIndex !== -1;
          const prefix = hasAt ? rawEmail.slice(0, atIndex) : rawEmail;
          const domain = hasAt ? rawEmail.slice(atIndex) : '';

          if (!hasAddress) {
            return (
              <span
                className="identity-value hub-val hub-val-email"
                role="status"
                aria-live="polite"
              >
                {isReal ? 'Gmail connected; no active address is available.' : rawEmail}
              </span>
            );
          }

          return (
            <button
              type="button"
              className="identity-value hub-val hub-val-email"
              title={`Click to copy: ${rawEmail}`}
              onClick={onCopyEmail}
              aria-label={`Copy email address ${rawEmail}`}
            >
              {hasAt ? (
                <>
                  <span className="hub-email-prefix">{prefix}</span>
                  <span className="hub-email-domain">{domain}</span>
                </>
              ) : (
                rawEmail
              )}
            </button>
          );
        })()}
        {isReal &&
          currentOriginalBase &&
          activeEmailAddress &&
          activeEmailAddress !== currentOriginalBase && (
            <div className="identity-original-email">Original: {currentOriginalBase}</div>
          )}
      </div>
      <div className="identity-actions">
        <button
          type="button"
          className={`action-icon ${emailCopied ? 'success' : ''}`}
          onClick={onCopyEmail}
          disabled={isReal ? !activeEmailAddress : !emailAccount?.fullEmail}
          title="Copy email"
          aria-label="Copy email address to clipboard"
        >
          {emailCopied ? <Check size={14} /> : <Copy size={14} />}
        </button>
        {!isReal && (
          <button
            className={`action-icon ${isGeneratingEmail ? 'action-loading' : ''} ${emailCooldown ? 'opacity-50' : ''}`}
            onClick={onGenerateEmail}
            type="button"
            disabled={isGeneratingEmail}
            aria-busy={isGeneratingEmail}
            title={
              isGeneratingEmail
                ? 'Generating new identity…'
                : isDisposableExpired
                  ? t('generateNewAddress')
                  : 'New identity'
            }
            aria-label={
              emailAccount?.fullEmail
                ? 'Generate new disposable email'
                : 'Generate disposable email'
            }
          >
            <RefreshCw size={14} className={isGeneratingEmail ? 'spin' : ''} />
          </button>
        )}
        {isReal && currentDisconnectHandler && (
          <button
            type="button"
            className="action-icon"
            onClick={currentDisconnectHandler}
            title="Disconnect account"
            aria-label="Disconnect email account"
          >
            <LogOut size={14} />
          </button>
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
  <div className="inbox-section" role="region" aria-label="Alias tracker">
    <div className="inbox-header-row">
      <div className="inbox-title-group">
        <Shield size={14} />
        <span role="heading" aria-level={2}>
          Alias tracker
        </span>
        {history.length > 0 && <span className="inbox-count">{history.length}</span>}
      </div>
      {history.length > 0 && (
        <button type="button" className="alias-clear-history-btn" onClick={onClear}>
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
          <div key={`${item.website}-${item.alias}-${item.createdAt}`} className="inbox-item">
            <EmailAvatar from={item.website || '?'} className="inbox-item-avatar" />
            <div className="inbox-item-content">
              <div className="inbox-item-header">
                <span className="inbox-item-from truncate">
                  {item.website || 'general'}
                  <span className="alias-history-type-badge">{item.type}</span>
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
            <button
              type="button"
              className="action-icon"
              aria-label={`Copy ${item.alias}`}
              onClick={() =>
                void copyToClipboard(item.alias).then((ok) => onToast(ok ? 'Copied' : 'Failed'))
              }
              title="Copy alias"
            >
              <Copy size={14} />
            </button>
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
    <div className="inbox-section" role="region" aria-label="Recent inbox">
      <div className="inbox-header-row">
        <div className="inbox-title-group">
          <Inbox size={14} />
          <span role="heading" aria-level={2}>
            Recent inbox
          </span>
          {!isManual && inbox.length > 0 && <span className="inbox-count">{inbox.length}</span>}
        </div>
        {!isManual && (
          <button
            type="button"
            className={`alias-inbox-refresh inbox-refresh-button ${loading ? 'alias-inbox-refresh--loading' : ''}`}
            onClick={onRefresh}
            disabled={loading}
            aria-busy={loading}
            aria-label="Refresh inbox"
          >
            <RefreshCw
              size={14}
              className={`inbox-refresh-icon${loading ? ' inbox-refresh-icon--spinning' : ''}`}
            />
          </button>
        )}
      </div>

      {isManual && (
        <div
          className="hub-empty-state"
          style={{ flexDirection: 'column', textAlign: 'center', marginTop: 8 }}
        >
          <Inbox size={22} color="var(--gf-primary)" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontWeight: 600, color: 'var(--gf-ink)', fontSize: '12px' }}>
              Inbox needs Google sign-in
            </span>
            <span style={{ fontSize: '10px' }}>Manual connection generates aliases only.</span>
          </div>
          <button
            type="button"
            onClick={onSignIn}
            disabled={signingIn}
            aria-busy={signingIn}
            className="gf-btn gf-btn--primary"
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              fontSize: '11px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              marginTop: 8,
            }}
          >
            {signingIn ? <RefreshCw size={13} className="spin" /> : <LogIn size={13} />}
            <span>{signingIn ? 'Connecting…' : 'Use Google sign-in'}</span>
          </button>
        </div>
      )}

      {error && (
        <div
          className="hub-empty-state hub-empty-state--action"
          role="alert"
          style={{ marginTop: 8 }}
        >
          <AlertCircle size={16} strokeWidth={1.7} color="var(--gf-coral)" />
          <span className="hub-empty-text">{error}</span>
        </div>
      )}

      {showLoading && (
        <div className="hub-empty-state" style={{ marginTop: 8 }}>
          <RefreshCw size={16} strokeWidth={1.5} className="spin" color="var(--gf-primary)" />
          <span>Syncing Gmail…</span>
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
          {inbox.map((msg) => {
            const senderSource = getSenderSource(msg.fromName, msg.fromEmail || msg.from);
            const content = msg.htmlBody || msg.body || msg.snippet;
            const senderLabel = getSenderLabel(senderSource, msg.subject, null, content);
            return (
              <button
                type="button"
                key={msg.id}
                className={`inbox-item ${msg.isUnread ? 'alias-inbox-item--unread' : ''}`}
                onClick={() => onOpenMessage(msg)}
                disabled={openingMessageId === msg.id}
                aria-label={`${msg.isUnread ? 'Open unread email' : 'Open email'} from ${senderLabel}: ${msg.subject}`}
                aria-busy={openingMessageId === msg.id}
              >
                <EmailAvatar
                  from={senderSource}
                  subject={msg.subject}
                  content={content}
                  className="inbox-item-avatar"
                />
                <span className="inbox-item-content">
                  <span className="inbox-item-header">
                    <span className="inbox-item-from truncate">{senderLabel}</span>
                    <span className="inbox-item-date">
                      <Clock size={10} />
                      {msg.dateFormatted || formatInboxRelativeDate(new Date(msg.date).getTime())}
                    </span>
                  </span>
                  <span className="inbox-item-subject truncate">
                    {msg.subject || '(No subject)'}
                  </span>
                </span>
                {openingMessageId === msg.id ? (
                  <RefreshCw
                    size={14}
                    className="inbox-item-open-chevron spin"
                    aria-hidden="true"
                  />
                ) : (
                  <ChevronRight size={14} className="inbox-item-open-chevron" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export { InboxTab as AliasInbox };

// --- AppSkeleton.tsx ---
const AppSkeleton = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`app-skeleton app-view-container ${className || ''}`}
        role="status"
        aria-label="Loading GhostFill"
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
              <div className="hub-empty-state">
                <div className="skeleton-pulse app-skeleton-circle skeleton-icon-md" />
                <div className="skeleton-pulse app-skeleton-pill skeleton-w-80" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
);

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
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef<boolean>(false);
  const titleId = useId();
  const descId = useId();
  useDialogIsolation(isOpen, overlayRef);

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
        e.stopPropagation();
        onCancelRef.current();
        return;
      }

      if (e.key === 'Tab') {
        if (!modalRef.current) {
          return;
        }
        const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe[tabindex="0"], [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length === 0) {
          return;
        }

        const first = focusableElements[0];
        const last = focusableElements[focusableElements.length - 1];

        if (!modalRef.current.contains(document.activeElement)) {
          e.preventDefault();
          (e.shiftKey ? last : first)?.focus();
          return;
        }

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
          ref={overlayRef}
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

      // The display only changes once per second; avoid a 4 Hz timer + rAF.
      timeoutId = setTimeout(updateTimer, Math.min(1000, remaining));
    };

    updateTimer();

    return () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
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
      aria-label={isExpired ? 'Expired' : `Expires in ${timeLeft}`}
    >
      {timeLeft}
    </span>
  );
};

// --- EmailAvatar.tsx ---
interface EmailAvatarProps {
  from: string;
  subject?: string | undefined;
  website?: string | null | undefined;
  content?: string | undefined;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

export const EmailAvatar: React.FC<EmailAvatarProps> = React.memo(
  ({ from, subject, website, content, className = '', style, children }) => {
    const safeFrom = contentToString(from);
    const senderLabel = useMemo(
      () => getSenderLabel(safeFrom, subject, website, content),
      [safeFrom, subject, website, content]
    );
    const sender = useMemo(() => parseEmailIdentity(safeFrom), [safeFrom]);
    const domain = sender.domain;
    const faviconSources = useMemo(() => {
      const domains = getSenderLogoDomains(safeFrom, website, content);
      const bundledLogo = domains.includes('chat.qwen.ai')
        ? qwenLogoImg
        : domains.includes('www.notion.com')
          ? notionLogoImg
          : null;
      return [
        ...(bundledLogo ? [bundledLogo] : []),
        ...domains.flatMap((host) => [
          `https://${host}/favicon.ico`,
          `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(`https://${host}`)}&sz=64`,
          `https://${host}/apple-touch-icon.png`,
        ]),
      ];
    }, [safeFrom, website, content]);
    const [faviconIndex, setFaviconIndex] = useState(0);
    const [loadedSource, setLoadedSource] = useState<string | null>(null);
    useEffect(() => {
      setFaviconIndex(0);
      setLoadedSource(null);
    }, [faviconSources]);
    const faviconSource = faviconSources[faviconIndex];

    useEffect(() => {
      if (!faviconSource || loadedSource === faviconSource) {
        return;
      }

      // A host can leave an image request pending without firing onError.
      // Move on so one slow logo endpoint cannot hold up the remaining sources.
      const timeout = window.setTimeout(() => {
        setFaviconIndex((index) => index + 1);
      }, 900);
      return () => window.clearTimeout(timeout);
    }, [faviconSource, loadedSource]);

    return (
      <div
        className={`email-avatar ${className}`.trim()}
        style={style}
        title={senderLabel || domain || safeFrom || undefined}
      >
        <span className="email-avatar-fallback" aria-hidden="true">
          {domain ? <Globe2 size={16} strokeWidth={1.8} /> : <Mail size={16} strokeWidth={1.8} />}
        </span>
        {faviconSource && (
          <img
            className="email-avatar-logo"
            src={faviconSource}
            width={32}
            height={32}
            alt=""
            aria-hidden="true"
            decoding="async"
            referrerPolicy="no-referrer"
            style={{ visibility: loadedSource === faviconSource ? 'visible' : 'hidden' }}
            onLoad={(event) => {
              if (event.currentTarget.naturalWidth <= 1 || event.currentTarget.naturalHeight <= 1) {
                setFaviconIndex((index) => index + 1);
              } else {
                setLoadedSource(faviconSource);
              }
            }}
            onError={() => setFaviconIndex((index) => index + 1)}
          />
        )}
        {children}
      </div>
    );
  }
);

EmailAvatar.displayName = 'EmailAvatar';

// --- EmailViewerModal.tsx ---
const openUrlInTab = (url: string): boolean => {
  try {
    const safe = new URL(url);
    if (safe.protocol !== 'http:' && safe.protocol !== 'https:') {
      return false;
    }
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      chrome.tabs.create({ url: safe.href, active: true });
      return true;
    } else if (typeof window !== 'undefined') {
      return Boolean(window.open(safe.href, '_blank', 'noopener,noreferrer'));
    }
  } catch {
    // Invalid URL — ignore.
  }
  return false;
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
  textBody?: string | undefined;
  htmlBody?: string | undefined;
  /** Detected actions (computed by parent via EXTRACT_OTP / link extraction) */
  otp?: string | null | undefined;
  link?: string | null | undefined;
}

export interface EmailViewerModalProps {
  /** Pass null to close. */
  message: EmailViewerMessage | null;
  messageKey?: string | number | null;
  loading?: boolean;
  error?: string | null;
  /** Disable the "Copy OTP" / "Open link" buttons (e.g. while loading). */
  onClose: () => void;
  onToast?: (msg: string) => void;
}

const MAX_BODY_CHARS = 18_000;
const MAX_RENDERABLE_HTML_CHARS = 300_000;
// MIME bodies often contain whitespace-only spacer lines from email tables.
// Keep paragraph breaks and meaningful indentation without reproducing those gaps.
const normalizePlainText = (text: string): string =>
  text
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/^[\t ]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
const EMAIL_MARKUP_RE =
  /<\/?(?:html|body|head|meta|title|table|thead|tbody|tfoot|tr|td|th|div|p|br|a|img|picture|source|h[1-6]|ul|ol|li|center|section|article|header|footer|span|strong|em|b|i|u|blockquote|pre|code|hr|font|small|mark|figure|figcaption|style)\b[^>]*>/i;

const stripHtml = (htmlInput: unknown): string => {
  const html = contentToString(htmlInput);
  if (!html) {
    return '';
  }
  try {
    const doc = new DOMParser().parseFromString(
      html.replace(/<\/(?:p|div|li|h[1-6]|tr|blockquote)>/gi, '$&\n'),
      'text/html'
    );

    // Security: Nuke dangerous elements completely
    doc
      .querySelectorAll('script, style, noscript, iframe, object, embed, link, meta')
      .forEach((el) => el.remove());

    // UX: Convert block elements to newlines for readability
    const blockTags = new Set([
      'P',
      'DIV',
      'BR',
      'LI',
      'H1',
      'H2',
      'H3',
      'H4',
      'H5',
      'H6',
      'TR',
      'BLOCKQUOTE',
    ]);
    let text = '';
    const walker = document.createTreeWalker(
      doc.body,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT
    );
    let node;

    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (blockTags.has(node.nodeName)) {
          text += '\n';
        } else if (node.nodeName === 'TD') {
          text += '\t';
        }
      }
    }

    return normalizePlainText(text);
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

/** A one-line excerpt for inbox rows; never render sender markup as UI. */
export const getEmailPreview = (value: unknown): string => {
  const raw = contentToString(value).slice(0, 3_000);
  return (/<[a-z][^>]*>/i.test(raw) ? stripHtml(raw) : raw)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
};

const formatDate = (msg: EmailViewerMessage): string => {
  if (msg.dateFormatted) {
    return msg.dateFormatted;
  }
  if (typeof msg.date === 'string') {
    return msg.date;
  }
  if (typeof msg.date === 'number') {
    if (!Number.isFinite(msg.date) || msg.date <= 0) {
      return 'Date unavailable';
    }
    try {
      return new Date(msg.date).toLocaleString();
    } catch {
      return '';
    }
  }
  return '';
};

const formatCompactDate = (msg: EmailViewerMessage): string => {
  if (typeof msg.date === 'number' && (!Number.isFinite(msg.date) || msg.date <= 0)) {
    return formatDate(msg);
  }
  const raw = msg.date ?? msg.dateFormatted;
  const parsed = typeof raw === 'number' ? new Date(raw) : new Date(String(raw ?? ''));
  if (Number.isNaN(parsed.getTime())) {
    return formatDate(msg);
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    ...(parsed.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' as const }),
  }).format(parsed);
};

export const EmailViewerModal: React.FC<EmailViewerModalProps> = ({
  message,
  messageKey,
  loading = false,
  error = null,
  onClose,
  onToast,
}) => {
  const isOpen = Boolean(message);
  const subjectId = useId();
  const [bodyExpanded, setBodyExpanded] = useState(false);
  const [copiedOtp, setCopiedOtp] = useState(false);
  const [copiedText, setCopiedText] = useState(false);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const modalBodyRef = useRef<HTMLDivElement | null>(null);
  const htmlContainerRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const iframeKeyDocumentRef = useRef<Document | null>(null);
  const iframeKeyHandlerRef = useRef<((event: KeyboardEvent) => void) | null>(null);
  const iframeFitTimers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const copiedOtpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedTextTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useDialogIsolation(isOpen, overlayRef);

  // Best-fit: grow the iframe to its content height so the modal body owns
  // the ONLY scrollbar.
  //
  // Deliberately NO ResizeObserver here: observing the iframe body while
  // writing the iframe height creates a feedback loop on %-height mail
  // content (Chrome: "ResizeObserver loop completed with undelivered
  // notifications"). Instead we fit on load, re-fit when in-iframe images
  // settle (finite events), and run a short fixed series of delayed fits
  // for late-loading content — then stop touching the DOM entirely.
  // Every write is also delta-guarded (≤1px changes are skipped).
  const clearIframeFitTimers = useCallback(() => {
    for (const t of iframeFitTimers.current) {
      clearTimeout(t);
    }
    iframeFitTimers.current = [];
  }, []);

  const fitIframeToContent = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) {
      return;
    }
    try {
      const doc = iframe.contentDocument;
      if (!doc?.documentElement) {
        return;
      }
      const el = doc.documentElement;
      const body = doc.body;
      if (!body) {
        return;
      }
      const contentH = Math.max(
        body.scrollHeight,
        body.offsetHeight,
        el.scrollHeight,
        el.offsetHeight
      );
      if (!Number.isFinite(contentH) || contentH <= 0) {
        return;
      }
      // The frame has no own scrollbar. Size it to its full content so the
      // dialog body can scroll through the entire message without clipping.
      // Root measurements include the current viewport; padding them grows
      // the frame on every delayed fit even when the content has not changed.
      const fitted = Math.min(Math.max(contentH, 160), 12_000);
      const current = parseFloat(iframe.style.height) || iframe.clientHeight || 0;
      if (Math.abs(fitted - current) <= 1) {
        return;
      }
      iframe.style.height = `${Math.round(fitted)}px`;
    } catch {
      // Cross-origin or not-yet-ready — leave the default height.
    }
  }, []);

  const clearIframeKeyHandler = useCallback(() => {
    if (iframeKeyDocumentRef.current && iframeKeyHandlerRef.current) {
      iframeKeyDocumentRef.current.removeEventListener('keydown', iframeKeyHandlerRef.current);
    }
    iframeKeyDocumentRef.current = null;
    iframeKeyHandlerRef.current = null;
  }, []);

  const handleIframeLoad = useCallback(() => {
    clearIframeFitTimers();
    // Drop to the floor first so a tall previous mail can't pin a short
    // new one tall; the fits below grow it back to the real height.
    if (iframeRef.current) {
      iframeRef.current.style.height = '160px';
    }
    fitIframeToContent();
    if (modalBodyRef.current) {
      modalBodyRef.current.scrollTop = 0;
    }
    try {
      const doc = iframeRef.current?.contentDocument;
      clearIframeKeyHandler();
      if (doc) {
        const handleFrameKeyDown = (event: KeyboardEvent) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCloseRef.current();
            return;
          }
          if (event.key !== 'Tab') {
            return;
          }

          const frameFocusables = Array.from(
            doc.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            )
          );
          const first = frameFocusables[0];
          const last = frameFocusables[frameFocusables.length - 1];
          const atFrameBoundary =
            frameFocusables.length === 0 ||
            (event.shiftKey ? doc.activeElement === first : doc.activeElement === last);
          if (!atFrameBoundary) {
            return;
          }

          const modal = modalRef.current;
          const outerFocusables = modal
            ? Array.from(
                modal.querySelectorAll<HTMLElement>(
                  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe[tabindex="0"], [tabindex]:not([tabindex="-1"])'
                )
              )
            : [];
          const iframeIndex = outerFocusables.indexOf(iframeRef.current as HTMLElement);
          if (iframeIndex < 0 || outerFocusables.length === 0) {
            return;
          }
          const targetIndex = event.shiftKey
            ? (iframeIndex - 1 + outerFocusables.length) % outerFocusables.length
            : (iframeIndex + 1) % outerFocusables.length;
          event.preventDefault();
          outerFocusables[targetIndex]?.focus();
        };
        doc.addEventListener('keydown', handleFrameKeyDown);
        iframeKeyDocumentRef.current = doc;
        iframeKeyHandlerRef.current = handleFrameKeyDown;
      }
      const imgs = doc ? Array.from(doc.images ?? []) : [];
      const handleBrokenImage = (img: HTMLImageElement) => {
        try {
          if (img.naturalWidth !== 0) {
            return false;
          }
          const alt = img.alt.trim();
          if (img.hasAttribute('src') && alt && img.parentElement && doc) {
            const fallback = doc.createElement('span');
            fallback.textContent = alt;
            fallback.setAttribute('role', 'img');
            fallback.style.cssText =
              'display:inline-flex;align-items:center;max-width:100%;padding:6px 10px;border:1px solid #e5e7eb;border-radius:6px;background:#f9fafb;color:#4b5563;font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';
            img.replaceWith(fallback);
          } else {
            (img as HTMLElement).style.display = 'none';
          }
          return true;
        } catch {
          // ignore — visibility check is best-effort
        }
        return false;
      };
      for (const img of imgs) {
        // The sanitizer removes remote sender assets. Only local images can
        // reach this fallback, so blocked filenames never clutter the reader.
        if (!img.complete) {
          img.addEventListener(
            'load',
            () => {
              fitIframeToContent();
            },
            { once: true }
          );
          img.addEventListener(
            'error',
            () => {
              handleBrokenImage(img);
              fitIframeToContent();
            },
            { once: true }
          );
        } else {
          handleBrokenImage(img);
          fitIframeToContent();
        }
      }
    } catch {
      // ignore — timed fits below still run
    }
    // Short fixed series for late-loading/remote content, then silence.
    // No observers, no rAF loops — nothing left to feed a resize cycle.
    for (const delay of [120, 350, 900, 2000]) {
      iframeFitTimers.current.push(setTimeout(() => fitIframeToContent(), delay));
    }
  }, [clearIframeFitTimers, clearIframeKeyHandler, fitIframeToContent]);

  useEffect(() => {
    return () => {
      clearIframeFitTimers();
      if (copiedOtpTimerRef.current) {
        clearTimeout(copiedOtpTimerRef.current);
      }
      if (copiedTextTimerRef.current) {
        clearTimeout(copiedTextTimerRef.current);
      }
    };
  }, [clearIframeFitTimers]);

  useEffect(() => {
    // Re-fit when switching messages so stale heights never linger.
    // (HTML-string changes also re-fire the iframe onLoad above, which
    // resets to the floor and refits; this covers the text-mode path.)
    const iframe = iframeRef.current;
    const body = modalBodyRef.current;
    if (body) {
      body.scrollTop = 0;
    }
    if (iframe) {
      iframe.style.height = '160px';
    }
    fitIframeToContent();
  }, [message, fitIframeToContent]);

  // Some providers always include an `htmlBody` key, even when its value is
  // plain text. Select the first body that actually contains email markup;
  // otherwise the plain-text reader is the reliable fallback.
  const rawHtml =
    [message?.htmlBody, message?.body, message?.textBody]
      .map((candidate) => contentToString(candidate ?? ''))
      .find((candidate) => EMAIL_MARKUP_RE.test(candidate)) || '';
  const hasHtml = Boolean(rawHtml);
  const remoteAssetsBlocked = useMemo(
    () => containsRemoteEmailAssets(rawHtml.slice(0, MAX_RENDERABLE_HTML_CHARS)),
    [rawHtml]
  );

  const [viewMode, setViewMode] = useState<'html' | 'text'>('text');

  useEffect(() => {
    if (isOpen) {
      setViewMode('text');
      setBodyExpanded(false);
      setCopiedOtp(false);
      setCopiedText(false);
    }
  }, [isOpen, messageKey, hasHtml]);

  // ESC closes; Tab is trapped inside the dialog; focus enters on open and
  // returns to the opener on close (WCAG 2.4.3 / 2.1.2).
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    openerRef.current = document.activeElement as HTMLElement;
    const root = modalRef.current;
    root
      ?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe[tabindex="0"], [tabindex]:not([tabindex="-1"])'
      )[0]
      ?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key === 'Tab' && root) {
        const items = root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe[tabindex="0"], [tabindex]:not([tabindex="-1"])'
        );
        if (items.length === 0) {
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) {
          return;
        }
        if (!root.contains(document.activeElement)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        } else if (e.shiftKey && document.activeElement === first) {
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
      clearIframeKeyHandler();
      if (openerRef.current?.isConnected) {
        openerRef.current.focus();
      }
    };
  }, [isOpen, clearIframeKeyHandler]);

  const rawSender = getSenderSource(message?.fromName, message?.from || '');
  const sender = message
    ? getSenderLabel(
        rawSender,
        message.subject,
        message.link,
        rawHtml || contentToString(message.textBody || message.body || message.snippet)
      )
    : '';
  const avatarSource = getSenderSource(message?.fromName, message?.from || sender);
  const dateText = message ? formatDate(message) : '';
  const compactDateText = message ? formatCompactDate(message) : '';

  const sanitizedHtml = useMemo(() => {
    if (!hasHtml || !rawHtml) {
      return '';
    }
    return sanitizeEmailBody(rawHtml.slice(0, MAX_RENDERABLE_HTML_CHARS), undefined, {
      allowStyleTag: true,
    });
  }, [hasHtml, rawHtml]);

  const iframeSrcDoc = useMemo(() => {
    const htmlString = contentToString(sanitizedHtml);
    if (!htmlString) {
      return '';
    }
    const hasHead = /<head[\s>]/i.test(htmlString);
    const hasBody = /<body[\s>]/i.test(htmlString);
    const baseTargetTag = '<base target="_blank" rel="noopener noreferrer">';
    const contentPolicyTag = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'">`;
    // Best-fit reader: single centered column, no inner scrollbars, no
    // clipped tables/buttons. The iframe is sized to content (see
    // fitIframeToContent) and the modal body owns the only scrollbar.
    const responsiveStyle = `
      <style>
        html {
          overflow: hidden !important;
          background: #ffffff;
        }
        html, body {
          margin: 0 !important;
          padding: 0 !important;
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          overflow-x: hidden !important;
          overflow-y: hidden !important;
          box-sizing: border-box !important;
          word-break: break-word !important;
          overflow-wrap: anywhere !important;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          font-size: 13.5px;
          line-height: 1.6;
          color: #1a1a1a;
          background: #ffffff;
        }
        body {
          padding: 12px !important;
          margin: 0 auto !important;
          max-width: 100% !important;
        }
        *, *::before, *::after {
          box-sizing: border-box !important;
        }
        /* Keep email layout semantics, but give wide marketing tables a
           flexible width so content can breathe in the popup reader. */
        table, tbody, tr, td, th, div, center, section, article, p {
          max-width: 100% !important;
          box-sizing: border-box !important;
          min-width: 0 !important;
        }
        table {
          width: 100% !important;
          table-layout: auto !important;
          margin-left: auto !important;
          margin-right: auto !important;
        }
        td, th {
          word-break: break-word !important;
          overflow-wrap: anywhere !important;
        }
        /* Reset fixed pixel widths without forcing every cell into one
           narrow column. Top-level tables still span the reader below. */
        table[width], td[width], th[width], div[width],
        table[style*="width"], td[style*="width"], div[style*="width"] {
          max-width: 100% !important;
          width: auto !important;
          min-width: 0 !important;
        }
        body > table, body > table[width], body > table[style*="width"],
        body > center > table, body > center > table[width],
        body > div > table, body > div > table[width],
        body > div > center > table, body > div > center > table[width] {
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
        }
        /* Center fixed-width marketing wrappers instead of left-clipping */
        center > table, body > table, body > center {
          margin-left: auto !important;
          margin-right: auto !important;
        }
        /* Reclaim wide marketing padding: centered 600px cards routinely
           carry 30-40px side padding, which in a ~330px reader leaves a
           narrow text column with big white gutters (see Qwen mails).
           Clamp top-level and common container padding to 12px so the
           copy uses the full width. Centering is preserved. */
        body > div, body > center {
          width: 100% !important;
          max-width: 100% !important;
          padding-left: 12px !important;
          padding-right: 12px !important;
        }
        body > table > tbody > tr > td,
        body > center > table > tbody > tr > td,
        body > div > table > tbody > tr > td,
        body > div > center > table > tbody > tr > td {
          padding-left: 12px !important;
          padding-right: 12px !important;
        }
        div[class*="container" i], div[class*="wrapper" i],
        div[class*="content" i], td[class*="container" i] {
          padding-left: 12px !important;
          padding-right: 12px !important;
        }
        /* Wrap and gracefully scale headings so they never clip or truncate */
        h1, h2, h3, h4, h5, h6 {
          white-space: normal !important;
          word-break: break-word !important;
          overflow-wrap: anywhere !important;
        }
        h1 { font-size: clamp(16px, 5.2vw, 22px) !important; line-height: 1.25 !important; margin: 8px 0 !important; }
        h2 { font-size: clamp(14px, 4.6vw, 19px) !important; line-height: 1.3 !important; margin: 6px 0 !important; }
        h3 { font-size: clamp(13px, 4vw, 16px) !important; line-height: 1.35 !important; margin: 4px 0 !important; }
        p, span, td, div {
          white-space: normal !important;
          word-break: break-word !important;
          overflow-wrap: anywhere !important;
        }
        img {
          max-width: 100% !important;
          height: auto !important;
          display: block;
          margin: 8px auto;
        }
        /* Remote sender assets (logos, pixels) often fail inside the
           sandboxed frame — never show a broken-image glyph. Sourceless
           images are hidden by CSS; failed loads are hidden by script
           (see handleIframeLoad) since :broken isn't standard. */
        img[src=""], img:not([src]) {
          display: none !important;
        }
        a {
          color: #2563eb;
          word-break: break-word !important;
          overflow-wrap: anywhere !important;
        }
        /* Buttons should fit within viewport and not clip */
        a[style*="background"], a[class*="btn"], a[class*="button"], button {
          display: inline-block !important;
          max-width: 100% !important;
          white-space: normal !important;
          box-sizing: border-box !important;
          text-align: center !important;
          overflow-wrap: anywhere !important;
        }
      </style>
    `;

    if (hasHead && /<\/head>/i.test(htmlString)) {
      // Provider CSS lives in the head. Append our reader rules after it so
      // responsive constraints win without mutating the original email.
      return htmlString.replace(
        /<\/head>/i,
        `${contentPolicyTag}\n${baseTargetTag}\n${responsiveStyle}\n</head>`
      );
    } else if (hasHead) {
      return htmlString.replace(
        /<head[\s>]/i,
        (match) => `${match}\n${contentPolicyTag}\n${baseTargetTag}\n${responsiveStyle}\n`
      );
    } else if (hasBody) {
      return htmlString.replace(
        /<body[\s>]/i,
        (match) =>
          `\n<head>\n${contentPolicyTag}\n${baseTargetTag}\n${responsiveStyle}\n</head>\n${match}`
      );
    } else {
      return `<!DOCTYPE html><html><head><meta charset="utf-8">${contentPolicyTag}${baseTargetTag}${responsiveStyle}</head><body>${htmlString}</body></html>`;
    }
  }, [sanitizedHtml]);

  const plainTextBody = useMemo(() => {
    const preferredText = contentToString(message?.textBody ?? '');
    if (preferredText) {
      const text = normalizePlainText(
        EMAIL_MARKUP_RE.test(preferredText) ? stripHtml(preferredText) : preferredText
      ).slice(0, MAX_BODY_CHARS);
      // Some providers supply only the code in textBody. Recover the readable
      // message from HTML only when its visible verification code agrees.
      if (rawHtml && /^\d{4,8}$/.test(text)) {
        const htmlText = stripHtml(rawHtml.slice(0, MAX_RENDERABLE_HTML_CHARS)).slice(
          0,
          MAX_BODY_CHARS
        );
        const htmlCode =
          extractExplicitVerificationCode(htmlText) || /^\s*(\d{4,8})\s*$/m.exec(htmlText)?.[1];
        if (htmlCode === text) {
          return htmlText;
        }
      }
      return text;
    }
    if (message?.body && !/<[a-z][\s\S]*>/i.test(message.body)) {
      return normalizePlainText(contentToString(message.body)).slice(0, MAX_BODY_CHARS);
    }
    return rawHtml ? stripHtml(rawHtml.slice(0, MAX_BODY_CHARS)) : '';
  }, [message, rawHtml]);

  const isLong = plainTextBody.length > 1200;
  const snippet = contentToString(message?.snippet ?? '');

  // Presentation-layer safety net: the modal must surface the code + link
  // whenever they are visible in the mail, even if backend extraction
  // missed them (empty/slow/failed EXTRACT_OTP for this message). Backend
  // values win when present; these lightweight local detectors only fill
  // the gaps — heroes and footer therefore always agree with each other.
  const fallbackDetection = useMemo(() => {
    const text = `${plainTextBody}\n${snippet}`;
    let otp: string | null = null;
    // A UI fallback needs local instruction or a standalone code line. An
    // arbitrary six-digit URL path or message identifier is not an OTP.
    const textWithoutUrls = text.replace(/https?:\/\/\S+/gi, ' ').replace(/\b\S+@\S+\b/g, ' ');
    const codeMatch =
      /\b(?:enter|use|type|copy)\s+(\d{6,8})\s+to\s+(?:verify|confirm|sign\s*in|log\s*in|authenticate)\b/i.exec(
        textWithoutUrls
      ) || /^\s*(\d{6,8})\s*$/m.exec(textWithoutUrls);
    if (
      codeMatch?.[1] &&
      hasVerificationCodeEvidence(codeMatch[1], message?.subject || '', text, rawHtml)
    ) {
      otp = codeMatch[1];
    }
    const candidates = extractUrls(`${rawHtml}\n${text}\n${message?.link || ''}`).filter((url) => {
      const gate = scoreActivationLink(url, getAnchorInfo(rawHtml, url).anchorText);
      return !gate.hardReject && gate.cls !== 'unknown' && gate.quality >= SELECT_MIN_QUALITY;
    });
    const backendLink = message?.link && isWebUrl(message.link) ? new URL(message.link).href : null;
    const link =
      candidates.find((url) => new URL(url).href === backendLink) || candidates[0] || null;
    return { otp, link };
  }, [plainTextBody, snippet, rawHtml, message?.link, message?.subject]);

  const explicitCode = extractExplicitVerificationCode(plainTextBody || snippet);
  const backendCode =
    message?.otp &&
    !isSubjectDomainToken(message.otp, message.subject || '') &&
    hasVerificationCodeEvidence(
      message.otp,
      message.subject || '',
      plainTextBody || snippet,
      rawHtml
    )
      ? message.otp
      : null;
  const effectiveOtp = explicitCode || backendCode || fallbackDetection.otp || null;
  const effectiveLink = fallbackDetection.link;

  const handleCopyBody = async () => {
    const textToCopy = plainTextBody || snippet || rawHtml;
    try {
      const ok = await copyToClipboard(textToCopy);
      if (!ok) {
        onToast?.('Failed to copy');
        return;
      }
      setCopiedText(true);
      if (copiedTextTimerRef.current) {
        clearTimeout(copiedTextTimerRef.current);
      }
      copiedTextTimerRef.current = setTimeout(() => setCopiedText(false), 2000);
      onToast?.('Email content copied');
    } catch {
      onToast?.('Failed to copy');
    }
  };

  const handleCopyOtp = async () => {
    if (!effectiveOtp) {
      return;
    }
    try {
      const ok = await copyToClipboard(effectiveOtp);
      if (!ok) {
        onToast?.('Failed to copy');
        return;
      }
      setCopiedOtp(true);
      if (copiedOtpTimerRef.current) {
        clearTimeout(copiedOtpTimerRef.current);
      }
      copiedOtpTimerRef.current = setTimeout(() => setCopiedOtp(false), 2000);
      onToast?.('Verification code copied');
    } catch {
      onToast?.('Failed to copy');
    }
  };

  const handleOpenEffectiveLink = () => {
    if (effectiveLink && openUrlInTab(effectiveLink)) {
      onToast?.('Opening activation link…');
    } else {
      onToast?.('Could not open the activation link.');
    }
  };

  return (
    <AnimatePresence>
      {message && (
        <motion.div
          ref={overlayRef}
          className="alias-message-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: tweenIn }}
          exit={{ opacity: 0, transition: tweenOut }}
          onClick={onClose}
        >
          <motion.div
            ref={modalRef}
            className="alias-message-modal"
            initial={{ y: 12, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1, transition: tweenIn }}
            exit={{ y: 12, opacity: 0, scale: 0.98, transition: tweenOut }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby={subjectId}
          >
            <div className="alias-message-modal-header">
              <div className="email-viewer-header-top">
                <div className="alias-message-modal-title-group">
                  <EmailAvatar
                    from={avatarSource}
                    subject={message.subject}
                    website={effectiveLink}
                    content={rawHtml || plainTextBody}
                    className="email-viewer-avatar"
                  />
                  <div className="alias-message-modal-titles">
                    <div
                      id={subjectId}
                      className="alias-message-modal-title"
                      title={message.subject || '(No subject)'}
                    >
                      {message.subject || '(No subject)'}
                    </div>
                    <div className="alias-message-modal-meta">
                      {sender && (
                        <span
                          className="email-viewer-sender"
                          title={getSenderEmail(rawSender) || rawSender || undefined}
                        >
                          {sender}
                        </span>
                      )}
                      {dateText && (
                        <span className="email-viewer-date" title={dateText}>
                          {compactDateText}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="alias-message-modal-close"
                  onClick={onClose}
                  aria-label="Close message"
                  title="Close message"
                >
                  <X size={17} />
                </button>
              </div>
            </div>

            {error && (
              <div className="alias-inbox-error" role="alert">
                {error}
              </div>
            )}

            <div ref={modalBodyRef} className="alias-message-modal-body">
              {loading ? (
                <div className="alias-inbox-loading">
                  <RefreshCw size={20} className="spin" />
                  <span>Loading message…</span>
                </div>
              ) : (
                <>
                  {/* The code and link stay readable; actions live in the footer. */}
                  {effectiveOtp && (
                    <div className="email-hero-otp-banner">
                      <div className="email-hero-otp-info">
                        <div className="email-hero-otp-label">
                          <Zap size={12} />
                          <span>Verification code</span>
                        </div>
                        <div className="email-hero-otp-code">{effectiveOtp}</div>
                      </div>
                    </div>
                  )}

                  {effectiveLink && (
                    <button
                      type="button"
                      className="email-hero-link-banner"
                      onClick={handleOpenEffectiveLink}
                      aria-label={`Open verification link on ${new URL(effectiveLink).hostname}`}
                      title={effectiveLink}
                    >
                      <div className="email-hero-link-info">
                        <div className="email-hero-link-label">
                          <Link2 size={12} />
                          <span>Open verification link</span>
                        </div>
                        <div className="email-hero-link-url truncate" title={effectiveLink}>
                          {new URL(effectiveLink).hostname}
                        </div>
                      </div>
                      <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  )}

                  {viewMode === 'html' && hasHtml && sanitizedHtml ? (
                    <div ref={htmlContainerRef} className="alias-message-modal-html-container">
                      <iframe
                        ref={iframeRef}
                        title={message.subject || 'Email content'}
                        className="email-html-iframe"
                        sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
                        referrerPolicy="no-referrer"
                        srcDoc={iframeSrcDoc}
                        scrolling="no"
                        onLoad={handleIframeLoad}
                      />
                    </div>
                  ) : (
                    <>
                      <pre
                        className={
                          isLong && !bodyExpanded
                            ? 'alias-message-modal-content email-viewer-text-body email-viewer-truncated'
                            : 'alias-message-modal-content email-viewer-text-body'
                        }
                      >
                        {plainTextBody || snippet || 'No content available.'}
                      </pre>
                      {isLong && (
                        <button
                          type="button"
                          className="email-viewer-expand-btn"
                          onClick={() => setBodyExpanded((b) => !b)}
                        >
                          {bodyExpanded
                            ? 'Show less'
                            : `Show full message (${plainTextBody.length} chars)`}
                        </button>
                      )}
                    </>
                  )}
                  {viewMode === 'html' && remoteAssetsBlocked && (
                    <div className="email-privacy-notice">
                      <ShieldCheck size={13} aria-hidden="true" />
                      <span>Remote images blocked for privacy</span>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="alias-message-modal-actions">
              {hasHtml && (
                <div
                  className="alias-message-modal-view-toggle"
                  role="group"
                  aria-label="Email format"
                  data-view-mode={viewMode}
                >
                  <button
                    type="button"
                    className={`alias-view-toggle-btn ${viewMode === 'html' ? 'alias-view-toggle-btn--active' : ''}`}
                    onClick={() => setViewMode('html')}
                    title="View formatted email"
                    aria-pressed={viewMode === 'html'}
                  >
                    <span>Formatted</span>
                  </button>
                  <button
                    type="button"
                    className={`alias-view-toggle-btn ${viewMode === 'text' ? 'alias-view-toggle-btn--active' : ''}`}
                    onClick={() => setViewMode('text')}
                    title="View plain text"
                    aria-pressed={viewMode === 'text'}
                  >
                    <span>Text</span>
                  </button>
                </div>
              )}
              <button
                type="button"
                className={`alias-message-action-btn alias-message-action-btn--copy-message ${effectiveOtp || effectiveLink ? 'alias-message-action-btn--icon' : 'alias-message-action-btn--primary'}`}
                onClick={() => void handleCopyBody()}
                disabled={loading || !(plainTextBody || snippet || rawHtml)}
                aria-label={copiedText ? 'Message copied' : 'Copy message text'}
                title={copiedText ? 'Message copied' : 'Copy message text'}
              >
                {copiedText ? <Check size={15} /> : <Copy size={15} />}
                {!effectiveOtp && !effectiveLink && (
                  <span>{copiedText ? 'Copied' : 'Copy message'}</span>
                )}
              </button>
              {effectiveLink && !effectiveOtp && (
                <button
                  type="button"
                  className={`alias-message-action-btn alias-message-action-btn--open-link ${effectiveOtp ? '' : 'alias-message-action-btn--primary'}`}
                  onClick={handleOpenEffectiveLink}
                  disabled={loading}
                >
                  <Link2 size={15} />
                  <span>Open link</span>
                </button>
              )}
              {effectiveOtp && (
                <button
                  type="button"
                  className="alias-message-action-btn alias-message-action-btn--copy-code alias-message-action-btn--primary"
                  onClick={() => void handleCopyOtp()}
                  disabled={loading}
                  aria-label={copiedOtp ? 'Code copied' : `Copy verification code ${effectiveOtp}`}
                  title={`Copy verification code ${effectiveOtp}`}
                >
                  {copiedOtp ? <Check size={15} /> : <Copy size={15} />}
                  <span>{copiedOtp ? 'Code copied' : `Copy ${effectiveOtp}`}</span>
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// --- ErrorBoundary.tsx ---
const errorBoundaryLog = createLogger('PopupErrorBoundary');

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
    errorBoundaryLog.error('Uncaught popup render error', { error, errorInfo });
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
    // A rejected promise is not a UI crash. Log it so transient failures
    // (storage timeouts, network hiccups, third-party listeners) don't nuke
    // the whole popup into the crash screen. Only render errors that come
    // through getDerivedStateFromError get the crash UI.
    errorBoundaryLog.error('Unhandled popup promise rejection', event.reason);
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
    errorBoundaryLog.error('Global popup error', event.error);
    this.setState({ hasError: true, error: event.error });
  }

  public override render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-container">
          <div className="memphis-card error-card">
            <div className="error-icon-box">
              <AlertCircle className="error-icon-large" size={30} aria-hidden="true" />
            </div>
            <h2 className="error-title">System error</h2>
            <p className="error-message-box">
              The popup interface failed to render. Reset the interface to reload GhostFill.
            </p>
            <button
              type="button"
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

// Logo hover is pure CSS (.logo-circle:hover) — no JS animation on the
// header path (every hover re-render ran a 700ms JS tween).

/**
 * GhostFill brand mark — system UI.
 *
 * Refined, minimal ghost glyph for the Apple-inspired system:
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
  return (
    <div
      className={`ghost-logo-container ${className}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <img
        src={ghostLogoImg}
        width={size}
        height={size}
        alt="GhostFill Logo"
        className={`ghost-logo-img ${className}`}
        style={{ objectFit: 'contain' }}
      />
    </div>
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
        <div className="logo-circle" aria-hidden="true">
          <GhostLogo size={28} />
        </div>
        <div className="header-title-container">
          <h1 className="header-title">GhostFill</h1>
        </div>
      </div>
      <div className="header-actions">
        <IconButton
          label="Open help center"
          title="Help center (guides & FAQ)"
          onClick={onOpenHelp}
        >
          <HelpCircle size={18} strokeWidth={2} />
        </IconButton>
        <IconButton label="Open settings" title="Settings" onClick={onOpenSettings}>
          <Settings size={18} strokeWidth={2.2} />
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
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useDialogIsolation(open, overlayRef);

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
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key === 'Tab' && modal) {
        const focusable = getFocusable();
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!modal.contains(document.activeElement)) {
          e.preventDefault();
          (e.shiftKey ? last : first)?.focus();
        } else if (e.shiftKey) {
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
          ref={overlayRef}
          className="modal-overlay help-modal-overlay"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: tweenIn }}
          exit={{ opacity: 0, transition: tweenOut }}
        >
          <motion.div
            ref={cardRef}
            className="gf-card help-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-modal-title"
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1, transition: tweenIn }}
            exit={{ opacity: 0, scale: 0.95, transition: tweenOut }}
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
  /** Raw sender address retained for logo lookup when the visible label is only a name. */
  senderEmail?: string;
  otpCode?: string | null | undefined;
  activationLink?: string | null | undefined;
};

export interface InboxListProps {
  readonly preferredEmailType: 'disposable' | 'gmail' | 'zoho' | 'microsoft';
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

const formatInboxRelativeDate = (timestamp: number): string =>
  Number.isFinite(timestamp) && timestamp > 0 ? formatRelativeTime(timestamp) : 'Date unavailable';

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
  const openDisplayedEmail = useCallback(
    (emailItem: DisplayedEmail) => {
      if (onOpenEmail) {
        onOpenEmail(emailItem);
      } else if (preferredEmailType !== 'disposable') {
        onNavigate('aliases', { aliasTab: 'inbox' });
      } else {
        onNavigate('email');
      }
    },
    [onOpenEmail, onNavigate, preferredEmailType]
  );

  const canOpenInbox = preferredEmailType === 'disposable' && inboxCount > 0;
  // Real providers have no 'email' detail view — their manager lives in the
  // aliases view. Without this button that view is unreachable from the Hub
  // (row taps open the viewer directly).
  const canOpenAliases = preferredEmailType !== 'disposable';
  const canRefreshGmail = preferredEmailType === 'gmail' && gmailConnected && !gmailIsManual;

  return (
    <div className="inbox-section" role="region" aria-label="Inbox" data-empty={inboxCount === 0}>
      <div className="inbox-header-row">
        <div className="inbox-title-group">
          <Inbox size={16} className="inbox-title-icon" aria-hidden="true" />
          <span className="inbox-title-text" role="heading" aria-level={2}>
            Inbox
          </span>
          {inboxCount > 0 && (
            <span className="inbox-count" aria-label={`${inboxCount} messages`}>
              {inboxCount}
            </span>
          )}
        </div>
        {canRefreshGmail && (
          <button
            type="button"
            className="view-all-btn"
            onClick={() => void onFetchGmailInbox()}
            disabled={gmailInboxLoading}
            aria-label={gmailInboxLoading ? 'Refreshing Gmail inbox' : 'Refresh Gmail inbox'}
          >
            {gmailInboxLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
        {canOpenInbox && (
          <button
            type="button"
            className="view-all-btn"
            onClick={() => onNavigate('email')}
            aria-label="View full inbox"
          >
            {t('inboxViewAll')}
            <ChevronRight size={15} />
          </button>
        )}
        {canOpenAliases && (
          <button
            type="button"
            className="view-all-btn"
            onClick={() => onNavigate('aliases')}
            aria-label="Open alias manager"
          >
            Aliases
            <ChevronRight size={15} />
          </button>
        )}
      </div>

      {preferredEmailType === 'gmail' && gmailInboxError && (
        <div className="hub-empty-state hub-empty-state--action" role="alert">
          <AlertCircle size={18} strokeWidth={1.7} color="var(--gf-coral)" />
          <span className="hub-empty-text">{gmailInboxError}</span>
          <button
            type="button"
            className="view-all-btn"
            onClick={() => void onFetchGmailInbox()}
            disabled={gmailInboxLoading}
          >
            {gmailInboxLoading ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      )}

      <div className="inbox-list">
        {preferredEmailType === 'gmail' && !gmailConnected ? (
          <div className="hub-empty-state">
            <AlertCircle size={18} strokeWidth={1.7} color="var(--gf-coral)" />
            <span className="hub-empty-text">Connect Gmail above to sync OTP emails.</span>
          </div>
        ) : preferredEmailType === 'gmail' && gmailIsManual ? (
          <div className="hub-empty-state">
            <AlertCircle size={18} strokeWidth={1.7} color="var(--gf-amber)" />
            <span className="hub-empty-text">
              Use Google sign-in to sync messages automatically.
            </span>
          </div>
        ) : preferredEmailType === 'gmail' && gmailInboxLoading && inboxCount === 0 ? (
          <div className="hub-empty-state">
            <RefreshCw size={18} strokeWidth={1.5} className="spin" color="var(--gf-primary)" />
            <span>Syncing Gmail</span>
          </div>
        ) : preferredEmailType === 'gmail' &&
          gmailInboxError &&
          inboxCount === 0 ? null : inboxCount === 0 ? (
          <div className="hub-empty-state hub-empty-state--ready" role="status">
            <span className="inbox-empty-art" aria-hidden="true">
              <Inbox size={26} strokeWidth={1.4} />
            </span>
            <span className="hub-empty-copy">
              <strong>
                {preferredEmailType === 'gmail' ? t('inboxCaughtUpTitle') : t('inboxWaitingTitle')}
              </strong>
              <span>
                {preferredEmailType === 'gmail'
                  ? t('inboxRecentDescription')
                  : t('inboxWaitingDescription')}
              </span>
            </span>
          </div>
        ) : (
          <div className="hub-inbox-scroll">
            {displayedEmails.map((emailItem) => {
              // PERF: rows mount instantly — no stagger delay, no JS spring.
              // Hover is pure CSS (:hover border + chevron).
              const preview = getEmailPreview(emailItem.snippet || emailItem.body);
              const canOpenLink = Boolean(
                emailItem.activationLink && isWebUrl(emailItem.activationLink)
              );
              const senderSource = getSenderSource(emailItem.from, emailItem.senderEmail);
              const senderLabel = getSenderLabel(
                senderSource,
                emailItem.subject,
                emailItem.activationLink,
                emailItem.htmlBody || emailItem.textBody || emailItem.body || emailItem.snippet
              );
              return (
                <div key={emailItem.id} className="inbox-item" data-unread={!emailItem.read}>
                  <EmailAvatar
                    from={senderSource}
                    subject={emailItem.subject}
                    website={emailItem.activationLink}
                    content={
                      emailItem.htmlBody ||
                      emailItem.textBody ||
                      emailItem.body ||
                      emailItem.snippet
                    }
                    className="inbox-item-avatar"
                  />
                  <div className="inbox-item-content">
                    <div className="inbox-item-header">
                      <span className="inbox-item-from" title={emailItem.from || undefined}>
                        {!emailItem.read && (
                          <span className="inbox-unread-dot" aria-hidden="true" />
                        )}
                        <span className="inbox-sender-name">{senderLabel}</span>
                      </span>
                      <span className="inbox-item-date">
                        {formatInboxRelativeDate(new Date(emailItem.date).getTime())}
                      </span>
                    </div>
                    <div className="inbox-item-subject" title={emailItem.subject}>
                      {emailItem.subject}
                    </div>
                    {preview && !emailItem.otpCode && !canOpenLink && (
                      <div className="inbox-item-preview">{preview}</div>
                    )}
                    {(emailItem.otpCode || canOpenLink) && (
                      <div className="inbox-item-actions">
                        {emailItem.otpCode && (
                          <button
                            type="button"
                            className="otp-badge"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (emailItem.otpCode) {
                                onCopyOTP(emailItem.otpCode);
                              }
                            }}
                            aria-label={`Copy verification code ${emailItem.otpCode}`}
                          >
                            <span className="inbox-action-label" aria-hidden="true">
                              {t('copyShort')}
                            </span>
                            <span className="otp-badge-code" aria-hidden="true">
                              {emailItem.otpCode}
                            </span>
                            <Copy size={12} />
                          </button>
                        )}
                        {canOpenLink && emailItem.activationLink && (
                          <button
                            type="button"
                            className="link-badge"
                            onClick={(e) => {
                              if (emailItem.activationLink) {
                                void onOpenLink(e, emailItem.activationLink);
                              }
                            }}
                            aria-label="Open verification link"
                          >
                            <span className="otp-badge-code" aria-hidden="true">
                              Open link
                            </span>
                            <ChevronRight size={12} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="inbox-item-open-button"
                    aria-label={`${emailItem.read ? 'Open email' : 'Open unread email'} from ${senderLabel}: ${emailItem.subject}`}
                    aria-busy={openingEmailId === emailItem.id}
                    disabled={openingEmailId === emailItem.id}
                    onClick={() => openDisplayedEmail(emailItem)}
                  >
                    {openingEmailId === emailItem.id ? (
                      <RefreshCw
                        size={14}
                        className="inbox-item-open-chevron spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <ChevronRight
                        size={14}
                        className="inbox-item-open-chevron"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export const InboxList = React.memo(InboxListComponent);
InboxList.displayName = 'InboxList';

// --- Onboarding.tsx ---
interface OnboardingProps {
  onDismiss: () => void;
}

/** First-run welcome overlay. Extracted from App for clarity. */
const Onboarding: React.FC<OnboardingProps> = ({ onDismiss }) => {
  const titleRef = useRef<HTMLHeadingElement | null>(null);
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

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  return (
    <motion.div
      key="onboarding"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.16 } }}
      exit={{ opacity: 0, transition: { duration: 0.1 } }}
      className="onboarding-overlay"
    >
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.18, ease: [0.16, 1, 0.3, 1] } }}
        className="onboarding-logo onboarding-logo--mascot"
      >
        <img
          src={ghostLogoImg}
          width={104}
          height={104}
          alt="GhostFill"
          className="onboarding-mascot-img"
        />
      </motion.div>

      <motion.h1
        ref={titleRef}
        tabIndex={-1}
        initial={{ y: 8, opacity: 0 }}
        animate={{ y: 0, opacity: 1, transition: { duration: 0.16, delay: 0.03 } }}
        className="onboarding-title"
      >
        {t('onboardingTitle')}
      </motion.h1>

      <motion.p
        initial={{ y: 8, opacity: 0 }}
        animate={{ y: 0, opacity: 1, transition: { duration: 0.16, delay: 0.05 } }}
        className="onboarding-subtitle"
      >
        {t('onboardingSubtitle')}
      </motion.p>

      <motion.div
        initial={{ y: 8, opacity: 0 }}
        animate={{ y: 0, opacity: 1, transition: { duration: 0.16, delay: 0.07 } }}
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
      const expiry = Math.min(
        lastOTP.expiresAt ?? Infinity,
        lastOTP.extractedAt + LAST_OTP_MAX_AGE_MS
      );
      const total = Math.max(1, expiry - lastOTP.extractedAt);
      const remaining = total - elapsed;

      if (remaining <= 0) {
        setTimePercentage(0);
        setTimeText(hasExplicitExpiry ? 'Expired' : 'Likely expired');
      } else {
        setTimePercentage((remaining / total) * 100);
        const remainingSeconds = Math.ceil(remaining / 1000);
        const minutes = Math.floor(remainingSeconds / 60);
        const seconds = remainingSeconds % 60;
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
        aria-label="Verification code time remaining"
        aria-valuetext={timeText || 'Checking expiry'}
      >
        <div
          className="otp-timer-fill"
          style={{
            transform: `scaleX(${Math.max(0, Math.min(1, timePercentage / 100))})`,
            '--timer-color': timePercentage < 20 ? 'var(--gf-coral)' : 'var(--gf-primary)',
          }}
        />
      </div>
      <div
        className="otp-timer-info"
        role="timer"
        aria-label={`Verification code expiry ${timeText}`}
      >
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
  const lastOTP = useStorageSubscription('lastOTP', null);
  const [, setExpiryTick] = useState(0);
  const [copied, setCopied] = useState(false);
  const [filling, setFilling] = useState(false);
  const [autoFillShortcut, setAutoFillShortcut] = useState<string | null>('Alt+Shift+F');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof chrome === 'undefined' || typeof chrome.commands?.getAll !== 'function') {
      return;
    }
    let cancelled = false;
    void chrome.commands
      .getAll()
      .then((commands) => {
        if (!cancelled) {
          setAutoFillShortcut(
            commands.find((command) => command.name === 'auto-fill')?.shortcut || null
          );
        }
      })
      .catch(() => {
        // The manifest shortcut remains a useful fallback if Chrome cannot enumerate commands.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!lastOTP) {
      return;
    }
    const expiry = Math.min(
      lastOTP.expiresAt ?? Infinity,
      lastOTP.extractedAt + LAST_OTP_MAX_AGE_MS
    );
    const remaining = expiry - Date.now();
    if (remaining <= 0) {
      return;
    }
    const timer = setTimeout(() => setExpiryTick((tick) => tick + 1), remaining);
    return () => clearTimeout(timer);
  }, [lastOTP]);

  const activeOTP =
    lastOTP &&
    Date.now() < Math.min(lastOTP.expiresAt ?? Infinity, lastOTP.extractedAt + LAST_OTP_MAX_AGE_MS)
      ? lastOTP
      : null;

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
    if (!activeOTP) {
      return;
    }
    try {
      const copiedToClipboard = await copyToClipboard(activeOTP.code);
      if (!copiedToClipboard) {
        onToast('Copy failed');
        return;
      }
      setCopied(true);
      onToast('Verification code copied');

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => setCopied(false), 2500); // Longer confirmation
    } catch {
      onToast('Copy failed');
    }
  }, [activeOTP, onToast]);

  const fillOTP = useCallback(async () => {
    if (!activeOTP || filling) {
      return;
    }
    setFilling(true);
    try {
      if (typeof chrome === 'undefined' || typeof chrome.tabs?.query !== 'function') {
        onToast('Couldn’t access the active page. Copy the code instead.');
        return;
      }
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        onToast('Open a page with a verification form, then try again.');
        return;
      }
      const res = await safeSendTabMessage(tab.id, {
        action: 'FILL_OTP',
        payload: { otp: activeOTP.code },
      });
      if (res?.success) {
        onToast('Verification code filled');
        // Don't close popup - let user verify
      } else {
        onToast('Couldn’t fill a code on this page. Copy it instead.');
      }
    } catch {
      onToast('Couldn’t fill a code on this page. Copy it instead.');
    } finally {
      setFilling(false);
    }
  }, [activeOTP, filling, onToast]);

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

        {activeOTP ? (
          <div className="otp-focus-area">
            {/* PERF: plain div — CSS .otp-digit animation (140ms pop, 20ms
                cascade) replaces 6 parallel JS springs. Hover is CSS. */}
            <button
              type="button"
              className="otp-box"
              onClick={handleCopyOTP}
              aria-label={`Copy OTP code ${activeOTP.code.split('').join(' ')}`}
            >
              {activeOTP.code.split('').map((char: string, i: number) => (
                <span key={i} className="otp-digit">
                  {char}
                </span>
              ))}
            </button>

            <OTPTimerBar lastOTP={activeOTP} />

            {activeOTP.confidence && (
              <div className="otp-confidence-row">
                <span className="otp-confidence-label">Confidence</span>
                <div className="otp-confidence-bar">
                  <div
                    className="otp-confidence-fill"
                    style={{
                      '--confidence-scale': activeOTP.confidence,
                      '--confidence-color':
                        activeOTP.confidence >= 0.9
                          ? 'var(--gf-mint)'
                          : activeOTP.confidence >= 0.7
                            ? 'var(--gf-amber)'
                            : 'var(--gf-coral)',
                    }}
                  />
                </div>
                <span className="otp-confidence-value">
                  {Math.round(activeOTP.confidence * 100)}%
                </span>
              </div>
            )}

            <div className="otp-actions">
              <Button
                variant="primary"
                className="otp-action-primary"
                onClick={handleFillOTP}
                loading={filling}
                leftIcon={<Zap size={18} fill="white" />}
              >
                {filling ? 'Filling…' : 'Fill code'}
              </Button>
              <Button className="otp-action-secondary" onClick={handleCopyOTP}>
                {copied ? <Check size={18} color="var(--gf-success)" /> : <Copy size={18} />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="otp-empty-state">
            <div className="otp-loading-container" aria-hidden="true">
              <Inbox size={30} color="var(--gf-primary)" strokeWidth={1.5} />
            </div>

            <h3 className="otp-empty-title">{lastOTP ? 'Code expired' : 'Listening for codes'}</h3>
            <p className="otp-empty-desc">
              {lastOTP
                ? 'Check your inbox for a fresh verification code.'
                : 'Verification codes from your ghost inbox will appear here instantly.'}
            </p>
          </div>
        )}
      </div>

      <div className="memphis-card efficiency-tip-card">
        <div className="widget-label widget-label-no-margin">
          <Info size={16} className="sf-icon" />
          Shortcut
        </div>
        <div className="efficiency-tip-text">
          {autoFillShortcut ? (
            <>
              Press <kbd className="kbd-key">{autoFillShortcut}</kbd> on a page to fill the current
              form.
            </>
          ) : (
            <>Assign an Auto-fill shortcut in Chrome, or use Copy above.</>
          )}
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

  // Seed from Options > Passwords so the page reflects the saved recipe.
  // Runs once per mount (the popup remounts on every open).
  useEffect(() => {
    let cancelled = false;
    storageService
      .getSettings()
      .then((s) => {
        if (!cancelled && s?.passwordDefaults) {
          const stored = { ...s.passwordDefaults };
          setOptions(stored);
          setLocalLength(stored.length);
        }
      })
      .catch(() => {
        // service defaults stand
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
      onToast(t('passwordGenerateFailed'));
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
        onToast(t('copyFailed'));
        return;
      }
      setCopied(true);
      onToast(t('passwordCopied'));

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => setCopied(false), TIMING.COPY_CONFIRMATION_MS); // Longer confirmation
    } catch {
      onToast(t('copyFailed'));
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
      <div className="memphis-card memphis-card-default">
        <div className="generator-card-header generator-card-header-center">
          <div className="widget-label widget-label-no-margin">
            <Lock size={16} className="sf-icon" aria-hidden="true" />
            {t('passwordLabel')}
          </div>
          <button
            type="button"
            className="back-button eye-button"
            onClick={() => setShowPassword((value) => !value)}
            aria-label={showPassword ? t('passwordHide') : t('passwordShow')}
            title={showPassword ? t('passwordHide') : t('passwordShow')}
            disabled={!password || loading}
          >
            {showPassword ? (
              <EyeOff size={18} aria-hidden="true" />
            ) : (
              <Eye size={18} aria-hidden="true" />
            )}
          </button>
        </div>
        <div className="password-terminal">
          <div
            className={`password-display-text ${showPassword ? 'password-display-visible' : 'password-display-hidden'}`}
            aria-hidden={!showPassword}
          >
            {password
              ? showPassword
                ? password.password
                : '•'.repeat(Math.min(password.password.length, 16))
              : '•'.repeat(Math.min(options.length, 16))}
          </div>
          {password && !showPassword && <span className="sr-only">{t('passwordHidden')}</span>}
        </div>

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
            <div className="strength-bar-bg" aria-hidden="true">
              <div
                className="strength-bar-fill"
                data-level={strengthLevel(password.strength.score)}
                style={{
                  transform: `scaleX(${strengthPercent(password.strength.score) / 100})`,
                }}
              />
            </div>
          </div>
        )}

        <div className="generator-actions">
          <Button
            variant="primary"
            onClick={handleGeneratePassword}
            loading={loading}
            leftIcon={<RefreshCw size={18} aria-hidden="true" />}
          >
            {loading
              ? t('generatingPassword')
              : password
                ? t('passwordGenerateAgain')
                : t('passwordGenerate')}
          </Button>
          <Button onClick={handleCopyPassword} disabled={!password || loading}>
            {copied ? (
              <Check size={18} color="var(--gf-success)" aria-hidden="true" />
            ) : (
              <Copy size={18} aria-hidden="true" />
            )}
            {copied ? t('copiedShort') : t('copyShort')}
          </Button>
        </div>
      </div>

      <div className="memphis-card memphis-card-default memphis-card-mt16">
        <div className="widget-label config-label config-label-spaced">
          <Shield size={16} className="sf-icon" aria-hidden="true" />
          {t('passwordOptions')}
        </div>

        {/* Length Slider */}
        <div className="slider-container">
          <div className="slider-header">
            <span>{t('passwordLength')}</span>
            <span className="slider-value">{options.length}</span>
          </div>
          <input
            type="range"
            className="strength-range-input"
            min="8"
            max="64"
            value={localLength}
            onChange={(e) => setLocalLength(Number(e.target.value))}
            aria-label={t('passwordLength')}
          />
        </div>

        {/* Toggle Pills Grid */}
        <div className="toggle-pills-grid">
          {[
            {
              id: 'uppercase',
              label: t('uppercaseShort'),
              accessibleLabel: t('uppercaseLetters'),
              icon: 'ABC',
            },
            {
              id: 'lowercase',
              label: t('lowercaseShort'),
              accessibleLabel: t('lowercaseLetters'),
              icon: 'abc',
            },
            { id: 'numbers', label: t('numbers'), accessibleLabel: t('numbers'), icon: '123' },
            { id: 'symbols', label: t('symbols'), accessibleLabel: t('symbols'), icon: '#@!' },
          ].map((opt) => {
            const isActive = Boolean(options[opt.id as keyof PasswordOptions]);
            return (
              <button
                key={opt.id}
                type="button"
                className={`toggle-pill ${isActive ? 'active' : ''}`}
                onClick={() => handleOptionChange(opt.id as keyof PasswordOptions, !isActive)}
                aria-pressed={isActive}
                aria-label={opt.accessibleLabel}
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
  readonly showPassword: boolean;
  readonly onCopyPassword: () => void;
  readonly onToggleShowPassword: () => void;
  readonly onGeneratePassword: () => void;
}

const QuickActionsComponent: React.FC<QuickActionsProps> = ({
  password,
  passwordCopied,
  isGeneratingPassword,
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
          className={`identity-value mono hub-val ${!showPassword && password ? 'password-bullets' : ''}`}
        >
          {!password
            ? isGeneratingPassword
              ? t('generatingPassword')
              : t('passwordNotGenerated')
            : showPassword
              ? password
              : '********'}
        </span>
      </div>
      <div className="identity-actions">
        <button
          type="button"
          className={`action-icon ${passwordCopied ? 'success' : ''}`}
          onClick={onCopyPassword}
          title="Copy password"
          aria-label="Copy password to clipboard"
          disabled={!password || isGeneratingPassword}
        >
          {passwordCopied ? <Check size={14} /> : <Copy size={14} />}
        </button>
        <button
          type="button"
          className="action-icon"
          onClick={onToggleShowPassword}
          title={showPassword ? 'Hide' : 'Show'}
          aria-label={showPassword ? 'Hide password' : 'Show password'}
          disabled={!password || isGeneratingPassword}
        >
          {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
        <button
          type="button"
          className="action-icon"
          onClick={onGeneratePassword}
          title="Generate new password"
          aria-label="Generate new secure password"
          disabled={isGeneratingPassword}
        >
          <RefreshCw size={14} className={isGeneratingPassword ? 'spin' : ''} />
        </button>
      </div>
    </div>
  );
};

export const QuickActions = React.memo(QuickActionsComponent);
QuickActions.displayName = 'QuickActions';
