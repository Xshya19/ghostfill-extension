import { motion, AnimatePresence } from 'framer-motion';
import { Mail, Copy, RefreshCw, Inbox, Clock, ChevronRight, ChevronLeft, Zap } from 'lucide-react';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '../../shared/ui';
import { interactiveSurface, springSoft } from '../../shared/ui/motion';
import { EmailAccount, Email } from '../../types';
import { formatRelativeTime, copyToClipboard, openSafeUrl } from '../../utils/core';
import { safeSendMessage } from '../../utils/messaging';
import { useOTPExtractor } from '../hooks/useOTPExtractor';

import { useStorageSubscription } from '../hooks/useStorageSubscription';
import { ConfirmModal, EmailAvatar } from './SharedComponents';

// i18n helper
const t = (key: string): string => {
  try {
    return chrome.i18n.getMessage(key) || key;
  } catch {
    return key;
  }
};

/**
 * Detects text direction (e.g. RTL for Arabic/Hebrew) and returns appropriate attributes.
 */
const getLangAttr = (text: string): { dir?: 'rtl' | 'ltr'; lang?: string } | undefined => {
  if (!text) {
    return undefined;
  }
  // Match RTL characters (Arabic, Hebrew, Syriac, etc.)
  const rtlRegex =
    /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  if (rtlRegex.test(text)) {
    return { dir: 'rtl' };
  }
  return undefined;
};

function getEmailTimestamp(email: Email): number {
  return typeof email.date === 'number' && Number.isFinite(email.date) && email.date > 0
    ? email.date
    : Date.now();
}

interface Props {
  onToast: (message: string) => void;
  emailAccount: EmailAccount | null;
  onGenerate: () => void;
  syncing: boolean;
  variant?: 'default' | 'inbox';
  onBack?: () => void;
}

const EmailGenerator: React.FC<Props> = ({
  onToast,
  emailAccount,
  onGenerate,
  syncing,
  variant = 'default',
  onBack,
}) => {
  const rawInbox = useStorageSubscription('inbox', []);
  const inbox = Array.isArray(rawInbox) ? rawInbox : [];
  const [checking, setChecking] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(Date.now());
  const [syncError, setSyncError] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [timeLeft, setTimeLeft] = useState<string>('');
  const lastCheckedIdRef = useRef<string | null>(null);

  // Memoize top 50 emails and asynchronously fetch their OTPs
  const latestInbox = React.useMemo(() => inbox.slice(0, 50), [inbox]);
  const { otps: emailOTPs, links: emailLinks } = useOTPExtractor(latestInbox);

  const checkInbox = useCallback(
    async (showToast = true): Promise<boolean> => {
      if (!emailAccount) {
        return false;
      }
      setChecking(true);
      try {
        const response = await safeSendMessage({
          action: 'CHECK_INBOX',
          payload: { email: emailAccount.fullEmail, service: emailAccount.service },
        });
        if (response && response.success) {
          // We rely on useStorageSubscription to update the actual inbox array
          const emails =
            response && 'emails' in response && Array.isArray(response.emails)
              ? response.emails
              : [];
          setLastUpdated(Date.now());
          setSyncError(null);
          if (showToast) {
            if (emails.length > 0) {
              onToast(`${emails.length} new email(s) found`);
            } else {
              onToast('Inbox is up to date (0 new)');
            }
          }
          return true;
        }
        setSyncError(response?.error || 'Sync failed: No response');
        if (showToast) {
          onToast(response?.error || 'Sync failed: No response');
        }
        return false;
      } catch {
        setSyncError('Connection lost');
        if (showToast) {
          onToast('Sync failed: Connection lost');
        }
        return false;
      } finally {
        setChecking(false);
      }
    },
    [emailAccount, onToast]
  );

  useEffect(() => {
    if (!emailAccount || !emailAccount.expiresAt) {
      return;
    }

    const updateTimer = () => {
      const remaining = emailAccount.expiresAt - Date.now();
      if (remaining <= 0) {
        setTimeLeft('Expired');
        return;
      }
      const totalMins = Math.floor(remaining / 60000);
      // Show hours for >60 minutes
      if (totalMins >= 60) {
        const hours = Math.floor(totalMins / 60);
        const mins = totalMins % 60;
        setTimeLeft(`${hours}h ${mins}m`);
        return;
      }
      const secs = Math.floor((remaining % 60000) / 1000);
      setTimeLeft(`${totalMins}:${secs < 10 ? '0' : ''}${secs}`);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [emailAccount]);

  useEffect(() => {
    if (emailAccount && emailAccount.fullEmail !== lastCheckedIdRef.current) {
      // Initial check without toast
      lastCheckedIdRef.current = emailAccount.fullEmail;
      void checkInbox(false);
    }
  }, [emailAccount?.fullEmail, checkInbox]);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const copyEmail = useCallback(async () => {
    if (!emailAccount) {
      return;
    }
    try {
      const copied = await copyToClipboard(emailAccount.fullEmail);
      if (!copied) {
        onToast('Copy failed');
        setCopySuccess(false);
        return;
      }
      setCopySuccess(true);
      onToast('Email copied');

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        setCopySuccess(false);
      }, 1500);
    } catch {
      onToast('Copy failed');
      setCopySuccess(false);
    }
  }, [emailAccount, onToast]);

  const copyCode = useCallback(
    async (code: string) => {
      const ok = await copyToClipboard(code);
      onToast(ok ? `Code ${code} copied` : 'Copy failed');
    },
    [onToast]
  );

  const openActivationLink = useCallback(
    (event: React.MouseEvent, activationLink: string) => {
      event.stopPropagation();
      onToast('Opening activation link...');
      openSafeUrl(activationLink);
    },
    [onToast]
  );

  return (
    <div className="generator-flow email-generator-flow">
      {emailAccount ? (
        <>
          {/* Active Identity Card - HIDE IN INBOX VARIANT */}
          {variant === 'default' && (
            <motion.div className="memphis-card email-generator-card" transition={springSoft}>
              {/* Decorative glow */}
              <div className="email-glow" />

              <div className="identity-header">
                <div className="widget-label widget-label-no-margin">
                  <div className="identity-label-icon">
                    <Mail size={14} strokeWidth={2.5} />
                  </div>
                  {t('activeIdentity')}
                </div>
                <div className="identity-sync-status">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={checking || syncing ? 'syncing' : 'updated'}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      className="identity-sync-text"
                    >
                      <RefreshCw size={12} className={checking || syncing ? 'spin' : ''} />
                      {checking
                        ? 'Checking...'
                        : syncing
                          ? 'Syncing...'
                          : `Updated ${formatRelativeTime(lastUpdated)}`}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>

              <div className="identity-content-wrapper">
                <div className="identity-email-info">
                  {/* Email Display - Terminal Style */}
                  <div className={`truncate terminal-prefix ${!emailAccount ? 'shimmer' : ''}`}>
                    {emailAccount.fullEmail.split('@')[0]}
                  </div>
                  <div className="terminal-domain">@{emailAccount.fullEmail.split('@')[1]}</div>

                  {/* Status Badges */}
                  <div className="identity-status-badges">
                    <div className="identity-status-temporary">
                      <div className="identity-status-dot" />
                      Temporary
                    </div>
                    {timeLeft && (
                      <div
                        className={`identity-status-time ${timeLeft === 'Expired' ? 'identity-status-expired' : ''}`}
                      >
                        <Clock size={12} strokeWidth={2.5} />
                        {timeLeft}
                      </div>
                    )}
                  </div>
                </div>

                <motion.button
                  className={`copy-button ${copySuccess ? 'copy-success' : ''}`}
                  onClick={() => void copyEmail()}
                  {...interactiveSurface}
                  aria-label="Copy email to clipboard"
                >
                  <Copy size={22} strokeWidth={2} />
                </motion.button>
              </div>
              {/* Action Buttons */}
              <div className="identity-actions-row">
                <Button
                  className="identity-action-btn"
                  onClick={() => setShowConfirm(true)}
                  disabled={syncing}
                >
                  <RefreshCw size={18} className={syncing ? 'spin' : ''} />
                  New Email
                </Button>
                <Button
                  variant="primary"
                  className="identity-action-btn"
                  onClick={() => void checkInbox()}
                  disabled={checking || timeLeft === 'Expired'}
                >
                  {timeLeft === 'Expired' ? (
                    <>
                      <Clock size={18} /> Expired
                    </>
                  ) : (
                    <>
                      <Inbox size={18} />
                      {checking ? 'Syncing...' : 'Sync Inbox'}
                    </>
                  )}
                </Button>
              </div>
            </motion.div>
          )}

          {/* Inbox Section */}
          <div
            className={`inbox-section-wrapper${variant === 'inbox' ? ' inbox-section-wrapper--inbox' : ''}`}
          >
            {syncError && (
              <div className="inbox-error-banner">
                <Zap size={14} /> {syncError}
              </div>
            )}
            {variant === 'inbox' ? (
              <motion.div
                className="inbox-section email-inbox-flex"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
              >
                {/* Header Row - Matching Dashboard inbox-header-row */}
                <div className="inbox-header-row email-inbox-header">
                  <div className="inbox-title-group">
                    {/* Back Button - Circular for Navigation */}
                    <motion.button
                      className="action-icon email-back-btn"
                      onClick={onBack}
                      {...interactiveSurface}
                      title="Go back"
                      aria-label="Go back to dashboard"
                    >
                      <ChevronLeft size={18} />
                    </motion.button>
                    <Inbox size={22} />
                    <span>Inbox</span>
                    {inbox.length > 0 && <span className="inbox-count">{inbox.length}</span>}
                  </div>
                  {/* Refresh: Just icon with tooltip, shows Syncing... when active */}
                  <motion.button
                    className="action-icon"
                    onClick={() => void checkInbox()}
                    disabled={checking}
                    {...interactiveSurface}
                    title={checking ? 'Syncing...' : 'Refresh inbox'}
                    aria-label="Refresh inbox"
                  >
                    <RefreshCw size={16} className={checking ? 'spin' : ''} />
                  </motion.button>
                </div>

                {/* Email List - Dashboard Style */}
                <div className="inbox-list inbox-list-scroll" aria-live="polite">
                  {latestInbox.length > 0 ? (
                    latestInbox.map((item: Email, i: number) => {
                      // Use shared utility functions
                      const verificationCode =
                        emailOTPs[item.id] !== undefined ? emailOTPs[item.id] : undefined;
                      const activationLink = emailLinks[item.id] || null;

                      return (
                        <motion.div
                          key={item.id}
                          className="inbox-item"
                          initial={{ opacity: 0, y: 16 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{
                            ...springSoft,
                            delay: Math.min(i * 0.03, 0.3),
                          }}
                        >
                          <EmailAvatar from={item.from} className="inbox-item-avatar">
                            {!item.read && <div className="unread-dot" title="Unread" />}
                          </EmailAvatar>
                          <div className="inbox-item-content">
                            <div className="inbox-item-header">
                              <span className="inbox-item-from" {...getLangAttr(item.from)}>
                                {item.from}
                              </span>
                              <span className="inbox-item-date">
                                {formatRelativeTime(getEmailTimestamp(item))}
                              </span>
                            </div>
                            <div className="inbox-item-subject" {...getLangAttr(item.subject)}>
                              {item.subject}
                            </div>

                            {/* Capsule Badges for OTP and Links */}
                            <div className="inbox-badges-row">
                              {verificationCode && (
                                <motion.button
                                  className="otp-badge"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void copyCode(verificationCode);
                                  }}
                                  {...interactiveSurface}
                                >
                                  <span className="otp-badge-code">🔢 {verificationCode}</span>
                                  <Copy size={12} />
                                </motion.button>
                              )}
                              {activationLink && (
                                <motion.button
                                  className="link-badge"
                                  onClick={(e) => void openActivationLink(e, activationLink)}
                                  {...interactiveSurface}
                                >
                                  <span className="otp-badge-code">Verify Link</span>
                                  <ChevronRight size={12} />
                                </motion.button>
                              )}
                            </div>
                          </div>
                        </motion.div>
                      );
                    })
                  ) : (
                    <div className="inbox-empty inbox-empty-large shimmer">
                      <div className="inbox-empty-icon-wrapper">
                        <Mail size={30} color="var(--gf-primary)" strokeWidth={1.5} />
                      </div>
                      <span className="inbox-empty-text-main">Listening for messages</span>
                      <span className="inbox-empty-text-sub">
                        Emails sent to your ghost address appear here in real-time
                      </span>
                    </div>
                  )}
                </div>
              </motion.div>
            ) : (
              <>
                <div className="widget-label">
                  <Inbox size={14} className="sf-icon" />
                  {t('activeIdentity')}
                </div>
                <div className="inbox-list-default">
                  {inbox.length > 0 ? (
                    inbox.slice(0, 50).map((item: Email, i: number) => {
                      // Use intelligently extracted payload maps
                      const verificationCode = emailOTPs[item.id] || null;
                      const activationLink = emailLinks[item.id] || null;

                      return (
                        <motion.div
                          key={item.id}
                          initial={{ opacity: 0, y: 16 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{
                            ...springSoft,
                            delay: Math.min(i * 0.03, 0.3),
                          }}
                          className="inbox-item-default"
                        >
                          {/* Avatar */}
                          <EmailAvatar from={item.from} className="inbox-item-avatar">
                            {!item.read && <div className="unread-dot" title="Unread" />}
                          </EmailAvatar>

                          {/* Content */}
                          <div className="inbox-content-default">
                            <div className="inbox-header-default">
                              <div
                                className="inbox-from-default truncate"
                                {...getLangAttr(item.from)}
                              >
                                {item.from}
                              </div>
                              <div className="inbox-date-default">
                                {formatRelativeTime(getEmailTimestamp(item))}
                              </div>
                            </div>
                            <div
                              className="inbox-subject-default truncate"
                              {...getLangAttr(item.subject)}
                            >
                              {item.subject}
                            </div>

                            {/* Capsule Badges */}
                            <div className="inbox-badges-default">
                              {verificationCode && (
                                <motion.button
                                  className="otp-badge"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void copyCode(verificationCode);
                                  }}
                                  {...interactiveSurface}
                                >
                                  🔢 {verificationCode}
                                  <Copy size={12} />
                                </motion.button>
                              )}
                              {activationLink && (
                                <motion.button
                                  className="link-badge"
                                  onClick={(e) => void openActivationLink(e, activationLink)}
                                  {...interactiveSurface}
                                >
                                  Verify Link
                                  <ChevronRight size={12} />
                                </motion.button>
                              )}
                            </div>
                          </div>

                          <ChevronRight size={18} color="var(--gf-text-muted)" strokeWidth={2.5} />
                        </motion.div>
                      );
                    })
                  ) : (
                    <div className="inbox-empty-card">
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="inbox-empty-container"
                      >
                        <div className="inbox-empty-icon">
                          <Inbox
                            size={32}
                            strokeWidth={1.5}
                            className="email-empty-icon"
                          />
                        </div>
                        <div className="inbox-empty-title">Inbox is Empty</div>
                        <div className="inbox-empty-desc">
                          Messages will appear here when received.
                        </div>
                      </motion.div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      ) : (
        <div className="memphis-card missing-identity-card">
          <div className="shimmer-icon-container missing-identity-icon-box">
            <Mail size={52} color="var(--gf-primary)" className="icon-faded" />
          </div>
          <h3 className="missing-identity-title">{t('identityRequired')}</h3>
          <p className="no-identity-desc">{t('generateIdentityMessage')}</p>
          <Button
            variant="primary"
            className="generate-identity-btn"
            onClick={onGenerate}
            disabled={syncing}
          >
            {syncing ? <span className="spinner-small" /> : <Zap size={18} fill="white" />}
            {syncing ? t('syncingIdentity') : t('generateIdentity')}
          </Button>
        </div>
      )}

      <ConfirmModal
        isOpen={showConfirm}
        title="Generate New Email?"
        message="Your current temporary email and its inbox will be permanently lost. This action cannot be undone."
        confirmText="Generate"
        cancelText="Cancel"
        onConfirm={() => {
          setShowConfirm(false);
          onGenerate();
        }}
        onCancel={() => setShowConfirm(false)}
        isDestructive={true}
      />
    </div>
  );
};

export default EmailGenerator;
