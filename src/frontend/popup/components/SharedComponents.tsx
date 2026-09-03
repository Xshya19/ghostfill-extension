import { motion, AnimatePresence, useReducedMotion, type HTMLMotionProps } from 'framer-motion';
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
  Sparkles,
  Zap,
  ShieldCheck,
  Hash,
  Info,
  Lock,
  Eye,
  EyeOff,
  Globe,
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

import ghostLogoImg from '../../../assets/logo.png';

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
import { LastOTP } from '../../../types/storage.types';
import { TIMING, formatRelativeTime, copyToClipboard, contentToString } from '../../../utils/core';
import { createLogger } from '../../../utils/logger';
import { safeSendMessage, safeSendTabMessage } from '../../../utils/messaging';
import { sanitizeEmailBody } from '../../../utils/sanitization.core';
import {
  springSoft,
  interactiveSurface,
  tweenIn,
  tweenOut,
  tweenTimerBar,
  springDigit,
  Button,
  IconButton,
} from '../../ui';
import { useStorageSubscription } from '../hooks';
import { GmailLogo, ZohoLogo, OutlookLogo } from './ProviderLogos';

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
  readonly preferredEmailType: 'disposable' | 'real' | 'gmail' | 'zoho' | 'microsoft';
  readonly selectedRealProvider?: 'gmail' | 'zoho' | 'microsoft';
  readonly onSelectRealProvider?: (provider: 'gmail' | 'zoho' | 'microsoft') => void;
  readonly gmailConnected: boolean;
  readonly gmailSigningIn: boolean;
  readonly gmailBase: string | null;
  readonly zohoConnected?: boolean;
  readonly zohoSigningIn?: boolean;
  readonly zohoBase?: string | null;
  readonly microsoftConnected?: boolean;
  readonly microsoftSigningIn?: boolean;
  readonly microsoftBase?: string | null;
  readonly activeEmailAddress: string;
  readonly emailAccount: EmailAccount | null;
  readonly emailCopied: boolean;
  readonly isGeneratingEmail: boolean;
  readonly emailCooldown: boolean;
  readonly onCopyEmail: () => void;
  readonly onGenerateEmail: () => void;
  readonly onGmailSignIn: () => void | Promise<void>;
  readonly onZohoSignIn?: () => void | Promise<void>;
  readonly onMicrosoftSignIn?: () => void | Promise<void>;
  readonly onSignOut?: () => void;
  readonly onZohoSignOut?: () => void;
  readonly onMicrosoftSignOut?: () => void;
  readonly gmailProfile?: any;
  readonly zohoProfile?: any;
  readonly microsoftProfile?: any;
}

const AccountCardComponent: React.FC<AccountCardProps> = ({
  preferredEmailType,
  selectedRealProvider = 'gmail',
  onSelectRealProvider,
  gmailConnected,
  gmailSigningIn,
  gmailBase,
  zohoConnected = false,
  zohoSigningIn = false,
  zohoBase,
  microsoftConnected = false,
  microsoftSigningIn = false,
  microsoftBase,
  activeEmailAddress,
  emailAccount,
  emailCopied,
  isGeneratingEmail,
  emailCooldown,
  onCopyEmail,
  onGenerateEmail,
  onGmailSignIn,
  onZohoSignIn,
  onMicrosoftSignIn,
  onSignOut,
  onZohoSignOut,
  onMicrosoftSignOut,
  gmailProfile,
  zohoProfile,
  microsoftProfile,
}) => {
  const isReal = preferredEmailType !== 'disposable';

  const providerSelector = isReal && onSelectRealProvider && (
    <div className="hub-provider-selector">
      <button
        type="button"
        className={`hub-provider-pill ${selectedRealProvider === 'gmail' ? 'hub-provider-pill--active' : ''}`}
        onClick={() => onSelectRealProvider('gmail')}
      >
        <GmailLogo size={14} />
        <span>Gmail</span>
      </button>
      <button
        type="button"
        className={`hub-provider-pill ${selectedRealProvider === 'zoho' ? 'hub-provider-pill--active' : ''}`}
        onClick={() => onSelectRealProvider('zoho')}
      >
        <ZohoLogo size={14} />
        <span>Zoho Mail</span>
      </button>
      <button
        type="button"
        className={`hub-provider-pill ${selectedRealProvider === 'microsoft' ? 'hub-provider-pill--active' : ''}`}
        onClick={() => onSelectRealProvider('microsoft')}
      >
        <OutlookLogo size={14} />
        <span>Outlook</span>
      </button>
    </div>
  );

  // 1. Gmail not connected
  if (isReal && selectedRealProvider === 'gmail' && !gmailConnected) {
    return (
      <div>
        {providerSelector}
        <div className="hub-gmail-not-connected">
          <GmailLogo size={44} className="hub-gmail-logo-img" />
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
      </div>
    );
  }

  // 2. Zoho Mail not connected
  if (isReal && selectedRealProvider === 'zoho' && !zohoConnected) {
    return (
      <div>
        {providerSelector}
        <div className="hub-provider-not-connected">
          <ZohoLogo size={44} className="hub-provider-logo-img" />
          <span className="hub-provider-title">Connect Zoho Mail</span>
          <span className="hub-provider-desc">
            Create aliases and auto-fill OTPs directly from your Zoho Mail inbox (Auto-detects
            US/EU/IN/AU/JP/CN).
          </span>
          <motion.button
            onClick={() => {
              void onZohoSignIn?.();
            }}
            className="hub-provider-connect-btn"
            {...interactiveSurface}
            disabled={zohoSigningIn}
          >
            {zohoSigningIn ? (
              <span>
                <RefreshCw size={14} className="spin" /> Connecting...
              </span>
            ) : (
              <span>Connect Zoho Mail</span>
            )}
          </motion.button>
        </div>
      </div>
    );
  }

  // 3. Microsoft Outlook not connected
  if (isReal && selectedRealProvider === 'microsoft' && !microsoftConnected) {
    return (
      <div>
        {providerSelector}
        <div className="hub-provider-not-connected">
          <OutlookLogo size={44} className="hub-provider-logo-img" />
          <span className="hub-provider-title">Connect Microsoft Outlook</span>
          <span className="hub-provider-desc">
            Create aliases and auto-fill OTPs from your @outlook.com, @hotmail.com, or @live.com
            account.
          </span>
          <motion.button
            onClick={() => {
              void onMicrosoftSignIn?.();
            }}
            className="hub-provider-connect-btn"
            {...interactiveSurface}
            disabled={microsoftSigningIn}
          >
            {microsoftSigningIn ? (
              <span>
                <RefreshCw size={14} className="spin" /> Connecting...
              </span>
            ) : (
              <span>Connect Outlook</span>
            )}
          </motion.button>
        </div>
      </div>
    );
  }

  const currentOriginalBase =
    selectedRealProvider === 'gmail'
      ? gmailBase
      : selectedRealProvider === 'zoho'
        ? zohoBase || zohoProfile?.email
        : microsoftBase || microsoftProfile?.email;

  const currentDisconnectHandler =
    selectedRealProvider === 'gmail'
      ? onSignOut
      : selectedRealProvider === 'zoho'
        ? onZohoSignOut
        : onMicrosoftSignOut;

  const providerLabel = !isReal
    ? t('emailLabel')
    : selectedRealProvider === 'gmail'
      ? 'Gmail Alias'
      : selectedRealProvider === 'zoho'
        ? 'Zoho Alias'
        : 'Outlook Alias';

  return (
    <div>
      {providerSelector}
      <div className="identity-row">
        <div className="identity-icon">
          {isReal && selectedRealProvider === 'gmail' ? (
            gmailProfile?.picture ? (
              <img
                src={gmailProfile.picture}
                alt=""
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  display: 'block',
                  objectFit: 'cover',
                }}
              />
            ) : (
              <GmailLogo size={18} />
            )
          ) : isReal && selectedRealProvider === 'zoho' ? (
            <ZohoLogo size={18} />
          ) : isReal && selectedRealProvider === 'microsoft' ? (
            <OutlookLogo size={18} />
          ) : (
            <Mail size={18} className="icon-premium" />
          )}
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
            const rawEmail = isReal
              ? activeEmailAddress || 'Connected'
              : emailAccount?.fullEmail || t('syncingIdentity');
            const atIndex = rawEmail.indexOf('@');
            const hasAt = atIndex !== -1;
            const prefix = hasAt ? rawEmail.slice(0, atIndex) : rawEmail;
            const domain = hasAt ? rawEmail.slice(atIndex) : '';

            return (
              <span
                className={`identity-value hub-val hub-val-email ${
                  !isReal && !emailAccount ? 'shimmer' : ''
                }`}
                title={`Click to copy: ${rawEmail}`}
                onClick={onCopyEmail}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onCopyEmail();
                  }
                }}
              >
                {hasAt ? (
                  <>
                    <span className="hub-email-prefix">{prefix}</span>
                    <span className="hub-email-domain">{domain}</span>
                  </>
                ) : (
                  rawEmail
                )}
              </span>
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
          <motion.button
            className={`action-icon ${emailCopied ? 'success' : ''}`}
            onClick={onCopyEmail}
            {...interactiveSurface}
            title="Copy email"
            aria-label="Copy email address to clipboard"
          >
            {emailCopied ? <Check size={14} /> : <Copy size={14} />}
          </motion.button>
          {!isReal && (
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
          {isReal && currentDisconnectHandler && (
            <motion.button
              className="action-icon"
              onClick={currentDisconnectHandler}
              {...interactiveSurface}
              title="Disconnect account"
              aria-label="Disconnect email account"
            >
              <LogOut size={14} />
            </motion.button>
          )}
        </div>
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
        <span>Alias tracker</span>
        {history.length > 0 && <span className="inbox-count">{history.length}</span>}
      </div>
      {history.length > 0 && (
        <button className="alias-clear-history-btn" onClick={onClear}>
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
          <span>Recent inbox</span>
          {!isManual && inbox.length > 0 && <span className="inbox-count">{inbox.length}</span>}
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
            onClick={onSignIn}
            disabled={signingIn}
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
            <span>{signingIn ? 'Connecting...' : 'Use Google sign-in'}</span>
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
              <EmailAvatar
                from={msg.fromName || msg.fromEmail || '?'}
                className="inbox-item-avatar"
              />
              <div className="inbox-item-content">
                <div className="inbox-item-header">
                  <span className="inbox-item-from truncate">{msg.fromName || msg.fromEmail}</span>
                  <span className="inbox-item-date">
                    <Clock size={10} />
                    {msg.dateFormatted || formatRelativeTime(new Date(msg.date).getTime())}
                  </span>
                </div>
                <div className="inbox-item-subject truncate">{msg.subject || '(No subject)'}</div>
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
const AppSkeleton = React.forwardRef<HTMLDivElement, HTMLMotionProps<'div'>>(
  ({ className, ...props }, ref) => {
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
    const safeFrom = contentToString(from);
    const domain = useMemo(() => extractDomain(safeFrom), [safeFrom]);

    const firstLetter = useMemo(() => {
      // Prefer the display name's first letter; fall back to the email/domain so we
      // never render a meaningless "?" when only an address is available.
      const displayName = safeFrom.replace(/<[^>]+>/, '').trim();
      const source = displayName || domain || safeFrom.trim();
      const firstChar = source.charAt(0);
      return /[a-z0-9]/i.test(firstChar) ? firstChar.toUpperCase() : '?';
    }, [safeFrom, domain]);

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

const stripHtml = (htmlInput: unknown): string => {
  const html = contentToString(htmlInput);
  if (!html) {
    return '';
  }
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');

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

    return text
      .replace(/&nbsp;/gi, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
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
  const [copiedOtp, setCopiedOtp] = useState(false);
  const [copiedText, setCopiedText] = useState(false);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const iframeFitTimers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

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
      // Tall enough to read, short enough to keep hero + footer visible.
      // The modal body scrolls past this — never the iframe itself.
      const fitted = Math.min(Math.max(contentH + 8, 160), 560);
      const current = parseFloat(iframe.style.height) || iframe.clientHeight || 0;
      if (Math.abs(fitted - current) <= 1) {
        return;
      }
      iframe.style.height = `${Math.round(fitted)}px`;
    } catch {
      // Cross-origin or not-yet-ready — leave the default height.
    }
  }, []);

  const handleIframeLoad = useCallback(() => {
    clearIframeFitTimers();
    // Drop to the floor first so a tall previous mail can't pin a short
    // new one tall; the fits below grow it back to the real height.
    if (iframeRef.current) {
      iframeRef.current.style.height = '160px';
    }
    fitIframeToContent();
    try {
      const doc = iframeRef.current?.contentDocument;
      const imgs = doc ? Array.from(doc.images ?? []) : [];
      const hideIfBroken = (img: HTMLImageElement) => {
        try {
          if (img.naturalWidth === 0) {
            (img as HTMLElement).style.display = 'none';
            return true;
          }
        } catch {
          // ignore — visibility check is best-effort
        }
        return false;
      };
      for (const img of imgs) {
        // Remote sender assets routinely fail in the sandbox; a broken
        // glyph in the middle of the mail reads as corruption, so hide it.
        if (!img.complete) {
          img.addEventListener(
            'load',
            () => {
              if (!hideIfBroken(img)) {
                fitIframeToContent();
              }
            },
            { once: true }
          );
          img.addEventListener(
            'error',
            () => {
              (img as unknown as HTMLElement).style.display = 'none';
              fitIframeToContent();
            },
            { once: true }
          );
        } else if (!hideIfBroken(img)) {
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
  }, [clearIframeFitTimers, fitIframeToContent]);

  useEffect(() => {
    return () => clearIframeFitTimers();
  }, [clearIframeFitTimers]);

  useEffect(() => {
    // Re-fit when switching messages so stale heights never linger.
    // (HTML-string changes also re-fire the iframe onLoad above, which
    // resets to the floor and refits; this covers the text-mode path.)
    const iframe = iframeRef.current;
    if (iframe) {
      iframe.style.height = '160px';
    }
    fitIframeToContent();
  }, [message, fitIframeToContent]);

  const rawHtml = contentToString(message?.htmlBody ?? message?.body ?? '');
  const hasHtml = Boolean(
    message?.htmlBody ||
    (/<[a-z][\s\S]*>/i.test(rawHtml) &&
      (rawHtml.includes('<p') ||
        rawHtml.includes('<div') ||
        rawHtml.includes('<table') ||
        rawHtml.includes('<br') ||
        rawHtml.includes('<a') ||
        rawHtml.includes('<span') ||
        rawHtml.includes('<html') ||
        rawHtml.includes('<body') ||
        rawHtml.includes('<center') ||
        rawHtml.includes('<style')))
  );

  const [viewMode, setViewMode] = useState<'html' | 'text'>(hasHtml ? 'html' : 'text');

  useEffect(() => {
    if (message) {
      setViewMode(hasHtml ? 'html' : 'text');
      setBodyExpanded(false);
      setCopiedOtp(false);
      setCopiedText(false);
    }
  }, [message, hasHtml]);

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

  const sanitizedHtml = useMemo(() => {
    if (!hasHtml || !rawHtml) {
      return '';
    }
    return sanitizeEmailBody(rawHtml.slice(0, 150_000), undefined, { allowStyleTag: true });
  }, [hasHtml, rawHtml]);

  const iframeSrcDoc = useMemo(() => {
    const htmlString = contentToString(sanitizedHtml);
    if (!htmlString) {
      return '';
    }
    const hasHead = /<head[\s>]/i.test(htmlString);
    const hasBody = /<body[\s>]/i.test(htmlString);
    const baseTargetTag = '<base target="_blank" rel="noopener noreferrer">';
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
        /* Make all tables and block containers responsive */
        table, tbody, tr, td, th, div, center, section, article, p {
          max-width: 100% !important;
          box-sizing: border-box !important;
          min-width: 0 !important;
        }
        table {
          width: 100% !important;
          table-layout: fixed !important;
          margin-left: auto !important;
          margin-right: auto !important;
        }
        td, th {
          word-break: break-word !important;
          overflow-wrap: anywhere !important;
        }
        table[width], td[width], th[width], div[width],
        table[style*="width"], td[style*="width"], div[style*="width"] {
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

    if (hasHead) {
      return htmlString.replace(
        /<head[\s>]/i,
        (match) => `${match}\n${baseTargetTag}\n${responsiveStyle}\n`
      );
    } else if (hasBody) {
      return htmlString.replace(
        /<body[\s>]/i,
        (match) => `\n<head>\n${baseTargetTag}\n${responsiveStyle}\n</head>\n${match}`
      );
    } else {
      return `<!DOCTYPE html><html><head><meta charset="utf-8">${baseTargetTag}${responsiveStyle}</head><body>${htmlString}</body></html>`;
    }
  }, [sanitizedHtml]);

  const plainTextBody = useMemo(() => {
    if (message?.body && !/<[a-z][\s\S]*>/i.test(message.body)) {
      return contentToString(message.body).slice(0, MAX_BODY_CHARS);
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
    // Standalone 6–8 digit code (authenticator style). Deliberately NOT
    // 4–5 digits here: years, ports and fragments false-positive too often
    // at this layer; the backend engine owns those cases.
    const codeMatch = /(?:^|[^\d])(\d{6,8})(?:[^\d]|$)/.exec(text);
    if (codeMatch?.[1]) {
      otp = codeMatch[1];
    }
    let link: string | null = null;
    const urlRe = /https?:\/\/[^\s"'<>)]+/gi;
    const candidates: string[] = [];
    const pushUrls = (s: string) => {
      if (!s) {
        return;
      }
      urlRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = urlRe.exec(s)) !== null) {
        candidates.push(m[0].replace(/[.,;!?]+$/, ''));
      }
    };
    pushUrls(rawHtml);
    pushUrls(text);
    const scored = candidates
      .map((url) => {
        const lower = url.toLowerCase();
        let score = 0;
        if (
          /activat|verify|confirm|magic|auth|signin|sign-in|login|validate|callback/.test(lower)
        ) {
          score += 3;
        }
        if (/[?&](token|id|code|key|hash|signature|t|u|email)=[^&]{4,}/.test(lower)) {
          score += 3;
        }
        if (
          /unsubscribe|preferences|privacy|terms|help|support|twitter|facebook|linkedin|instagram/.test(
            lower
          )
        ) {
          score -= 4;
        }
        return { url, score };
      })
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score);
    if (scored[0]) {
      link = scored[0].url;
    }
    return { otp, link };
  }, [plainTextBody, snippet, rawHtml]);

  const effectiveOtp = message?.otp || fallbackDetection.otp || null;
  const effectiveLink = message?.link || fallbackDetection.link || null;

  const handleCopyBody = () => {
    const textToCopy = plainTextBody || snippet || rawHtml;
    void copyToClipboard(textToCopy).then((ok) => {
      if (ok) {
        setCopiedText(true);
        setTimeout(() => setCopiedText(false), 2000);
        onToast?.('Email content copied');
      } else {
        onToast?.('Failed to copy');
      }
    });
  };

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
                <EmailAvatar from={sender || message.from || '?'} className="email-viewer-avatar" />
                <div className="alias-message-modal-titles">
                  <div
                    id="email-viewer-subject"
                    className="alias-message-modal-title truncate"
                    title={message.subject || '(No subject)'}
                  >
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

              <div className="alias-message-modal-header-actions">
                {hasHtml && (
                  <div className="alias-message-modal-view-toggle">
                    <button
                      type="button"
                      className={`alias-view-toggle-btn ${viewMode === 'html' ? 'alias-view-toggle-btn--active' : ''}`}
                      onClick={() => setViewMode('html')}
                      title="View rich HTML email"
                    >
                      <span>HTML</span>
                    </button>
                    <button
                      type="button"
                      className={`alias-view-toggle-btn ${viewMode === 'text' ? 'alias-view-toggle-btn--active' : ''}`}
                      onClick={() => setViewMode('text')}
                      title="View plain text"
                    >
                      <span>Text</span>
                    </button>
                  </div>
                )}
                <button
                  className="alias-message-modal-close"
                  onClick={onClose}
                  aria-label="Close message"
                >
                  <X size={16} />
                </button>
              </div>
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
                  {/* Hero OTP Card (backend value or local fallback) */}
                  {effectiveOtp && (
                    <div className="email-hero-otp-banner">
                      <div className="email-hero-otp-info">
                        <div className="email-hero-otp-label">
                          <Zap size={12} />
                          <span>Verification Code</span>
                        </div>
                        <div className="email-hero-otp-code">{effectiveOtp}</div>
                      </div>
                      <button
                        type="button"
                        className="email-hero-otp-btn"
                        onClick={() => {
                          void copyToClipboard(effectiveOtp ?? '').then((ok) => {
                            if (ok) {
                              setCopiedOtp(true);
                              setTimeout(() => setCopiedOtp(false), 2000);
                              onToast?.('Verification code copied!');
                            }
                          });
                        }}
                      >
                        {copiedOtp ? <Check size={13} /> : <Copy size={13} />}
                        <span>{copiedOtp ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                  )}

                  {/* Hero Link Card — always visible when a link exists so the
                      primary action is never hidden behind the OTP state. */}
                  {effectiveLink && (
                    <div className="email-hero-link-banner">
                      <div className="email-hero-link-info">
                        <div className="email-hero-link-label">
                          <Link2 size={12} />
                          <span>Activation Link</span>
                        </div>
                        <div className="email-hero-link-url truncate" title={effectiveLink}>
                          {effectiveLink}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="email-hero-link-btn"
                        onClick={() => openUrlInTab(effectiveLink ?? '')}
                      >
                        <Globe size={13} />
                        <span>Open Link</span>
                      </button>
                    </div>
                  )}

                  {snippet && snippet !== plainTextBody.slice(0, 200) && !hasHtml && (
                    <div className="alias-message-modal-snippet">{snippet}</div>
                  )}

                  {viewMode === 'html' && hasHtml && sanitizedHtml ? (
                    <div className="alias-message-modal-html-container">
                      <iframe
                        ref={iframeRef}
                        title={message.subject || 'Email content'}
                        className="email-html-iframe"
                        sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
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
                </>
              )}
            </div>

            <div className="alias-message-modal-actions">
              <button type="button" className="alias-message-action-btn" onClick={handleCopyBody}>
                {copiedText ? <Check size={14} /> : <Copy size={14} />}
                <span>{copiedText ? 'Copied' : 'Copy text'}</span>
              </button>
              {effectiveLink && (
                <button
                  type="button"
                  className="alias-message-action-btn alias-message-action-btn--primary"
                  onClick={() => openUrlInTab(effectiveLink ?? '')}
                >
                  <Link2 size={14} />
                  <span>Open link</span>
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
    // A rejected promise is not a UI crash. Log it so transient failures
    // (storage timeouts, network hiccups, third-party listeners) don't nuke
    // the whole popup into the crash screen. Only render errors that come
    // through getDerivedStateFromError get the crash UI.
    console.error('Unhandled promise rejection:', event.reason);
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
            <h2 className="error-title">System error</h2>
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
      <img
        src={ghostLogoImg}
        width={size}
        height={size}
        alt="GhostFill Logo"
        className={`ghost-logo-img ${className}`}
        style={{ objectFit: 'contain' }}
      />
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
          <GhostLogo size={42} />
        </div>
        <div className="header-title-container">
          <span className="header-title">GhostFill</span>
        </div>
      </div>
      <div className="header-actions">
        <IconButton label="Open help center" title="Help center" onClick={onOpenHelp}>
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
  otpCode?: string | null | undefined;
  activationLink?: string | null | undefined;
};

export interface InboxListProps {
  readonly preferredEmailType: 'disposable' | 'gmail' | 'zoho' | 'microsoft';
  readonly gmailConnected: boolean;
  readonly gmailIsManual: boolean;
  readonly gmailInboxLoading: boolean;
  readonly gmailInboxError: string | null;
  readonly zohoConnected?: boolean;
  readonly microsoftConnected?: boolean;
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
  zohoConnected = false,
  microsoftConnected = false,
  inboxCount,
  displayedEmails,
  openingEmailId,
  onNavigate,
  onCopyOTP,
  onOpenLink,
  onOpenEmail,
  onFetchGmailInbox,
}) => {
  const handleEmailInteraction = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent, emailItem: DisplayedEmail) => {
      const target = e.target as HTMLElement;
      if (target.closest('button')) {
        return;
      }
      if (
        e.type === 'keydown' &&
        (e as React.KeyboardEvent).key !== 'Enter' &&
        (e as React.KeyboardEvent).key !== ' '
      ) {
        return;
      }
      e.preventDefault();
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

  return (
    <motion.div className="inbox-section">
      <div className="inbox-header-row">
        <div className="inbox-title-group">
          <Inbox size={15} className="inbox-title-icon" />
          <span className="inbox-title-text">Inbox</span>
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
        {canOpenAliases && (
          <motion.button
            className="view-all-btn"
            onClick={() => onNavigate('aliases')}
            whileHover={{ x: 2 }}
            aria-label="Open alias manager"
          >
            Aliases
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
        ) : preferredEmailType === 'zoho' && !zohoConnected ? (
          <div className="hub-empty-state hub-empty-state--action">
            <AlertCircle size={18} strokeWidth={1.7} color="var(--gf-coral)" />
            <span className="hub-empty-text">Connect Zoho Mail above to sync OTP emails.</span>
          </div>
        ) : preferredEmailType === 'microsoft' && !microsoftConnected ? (
          <div className="hub-empty-state hub-empty-state--action">
            <AlertCircle size={18} strokeWidth={1.7} color="var(--gf-coral)" />
            <span className="hub-empty-text">Connect Outlook above to sync OTP emails.</span>
          </div>
        ) : preferredEmailType === 'gmail' && gmailIsManual ? (
          <div className="hub-empty-state hub-empty-state--action">
            <AlertCircle size={18} strokeWidth={1.7} color="var(--gf-amber)" />
            <span className="hub-empty-text">
              Use Google sign-in to sync messages automatically.
            </span>
          </div>
        ) : preferredEmailType === 'gmail' && gmailInboxLoading && inboxCount === 0 ? (
          <div className="shimmer hub-empty-state">
            <RefreshCw size={18} strokeWidth={1.5} className="spin" color="var(--gf-primary)" />
            <span>Syncing Gmail</span>
          </div>
        ) : gmailInboxError ? (
          // NOTE: despite the prop name, this carries Zoho/Outlook fetch
          // errors too (Hub writes all provider failures here). Render for
          // every provider — previously non-Gmail failures fell through to
          // the generic empty state and looked like "no mail".
          <button
            className="hub-empty-state hub-empty-state--action"
            onClick={() => void onFetchGmailInbox()}
          >
            <AlertCircle size={18} strokeWidth={1.7} color="var(--gf-coral)" />
            <span className="hub-empty-text">{gmailInboxError}</span>
          </button>
        ) : inboxCount === 0 ? (
          <div className="hub-empty-state">
            <Mail size={18} strokeWidth={1.5} color="var(--gf-primary)" />
            <span>
              {preferredEmailType === 'gmail'
                ? 'No Gmail messages yet.'
                : preferredEmailType === 'zoho'
                  ? 'No Zoho messages yet.'
                  : preferredEmailType === 'microsoft'
                    ? 'No Outlook messages yet.'
                    : t('listening')}
            </span>
          </div>
        ) : (
          <div className="hub-inbox-scroll">
            {displayedEmails.map((emailItem, index: number) => {
              return (
                <motion.div
                  key={emailItem.id}
                  className="inbox-item"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    ...tweenIn,
                    delay: 0.05 + index * 0.03,
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
                  <ChevronRight size={14} className="inbox-item-open-chevron" aria-hidden="true" />
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
              aria-label={`Copy OTP code ${lastOTP.code.split('').join(' ')}`}
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
                            ? 'var(--gf-amber)'
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
  // Opens the full password-vault detail view (length slider, options).
  // Without this the App 'password' view is unreachable from the Hub.
  readonly onOpenVault?: () => void;
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
  onOpenVault,
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
        {onOpenVault && (
          <>
            <div className="action-separator" />
            <motion.button
              className="action-icon"
              onClick={onOpenVault}
              {...interactiveSurface}
              title="Open password vault"
              aria-label="Open full password generator"
            >
              <ChevronRight size={14} />
            </motion.button>
          </>
        )}
      </div>
    </div>
  );
};

export const QuickActions = React.memo(QuickActionsComponent);
QuickActions.displayName = 'QuickActions';
