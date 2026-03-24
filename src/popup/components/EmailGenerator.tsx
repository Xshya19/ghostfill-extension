import { motion, AnimatePresence, Transition } from 'framer-motion';
import {
  Mail,
  Copy,
  RefreshCw,
  Inbox,
  Clock,
  Check,
  ChevronRight,
  ChevronLeft,
  Zap,
} from 'lucide-react';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { EmailAccount, Email } from '../../types';
import { TIMING } from '../../utils/constants';
import { formatRelativeTime, extractOTP, extractActivationLink } from '../../utils/formatters';
import { copyToClipboard } from '../../utils/helpers';
import { safeSendMessage } from '../../utils/messaging';

import { useStorageSubscription } from '../hooks/useStorageSubscription';

// i18n helper
const t = (key: string): string => {
  try {
    return chrome.i18n.getMessage(key) || key;
  } catch {
    return key;
  }
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
  const [syncError, setSyncError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number>(Date.now());
  const [timeLeft, setTimeLeft] = useState<string>('');
  const lastCheckedIdRef = useRef<string | null>(null);

  // Focus trap sub-refs and escape key listener for modal accessibility (H7)
  const confirmCancelBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showConfirm) {
        setShowConfirm(false);
      }
    };
    if (showConfirm) {
      window.addEventListener('keydown', handleKeyDown);
      // Auto-focus the cancel button when modal opens
      setTimeout(() => confirmCancelBtnRef.current?.focus(), 50);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showConfirm]);

  // iOS Spring Transition Config
  const springTransition: Transition = {
    type: 'spring',
    stiffness: 260,
    damping: 26,
    mass: 1,
  };

  const checkInbox = useCallback(
    async (showToast = true): Promise<boolean> => {
      if (!emailAccount) {
        return false;
      }
      setChecking(true);
      try {
        const response = await safeSendMessage({ action: 'CHECK_INBOX' });
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
      } catch (error) {
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

  const copyEmail = async () => {
    if (!emailAccount) {
      return;
    }
    try {
      await copyToClipboard(emailAccount.fullEmail);
      setCopied(true);
      onToast('Email copied');

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => setCopied(false), TIMING.COPY_CONFIRMATION_MS);
    } catch (error) {
      onToast('Copy failed');
    }
  };

  const openActivationLink = useCallback(
    async (event: React.MouseEvent, activationLink: string) => {
      event.stopPropagation();

      try {
        let safeUrl: string;
        try {
          safeUrl = new URL(activationLink).href;
          if (!safeUrl.startsWith('http://') && !safeUrl.startsWith('https://')) {
            throw new Error('Invalid URL protocol');
          }
        } catch {
          onToast('Invalid activation link URL');
          return;
        }

        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab?.id) {
          await chrome.tabs.update(activeTab.id, { url: safeUrl });
        } else {
          await chrome.tabs.create({ url: safeUrl });
        }
        onToast('Opening activation link...');
      } catch {
        onToast('Failed to open activation link');
      }
    },
    [onToast]
  );

  return (
    <div className="generator-flow">
      {emailAccount ? (
        <>
          {/* Active Identity Card - HIDE IN INBOX VARIANT */}
          {variant === 'default' && (
            <motion.div className="glass-card email-generator-card" transition={springTransition}>
              {/* Decorative glow */}
              <div className="email-glow" />

              <div className="identity-header">
                <div className="widget-label" style={{ margin: 0 }}>
                  <div className="identity-label-icon">
                    <Mail size={12} strokeWidth={2.5} />
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
                      <RefreshCw size={10} className={checking || syncing ? 'spin' : ''} />
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
                        <Clock size={10} strokeWidth={2.5} />
                        {timeLeft}
                      </div>
                    )}
                  </div>
                </div>

                <motion.button
                  className="copy-button"
                  onClick={() => void copyEmail()}
                  style={{
                    background: copied ? 'var(--badge-success)' : 'var(--list-item-bg)',
                    color: copied ? 'var(--success)' : 'var(--text-primary)',
                  }}
                  whileTap={{ scale: 0.9 }}
                  aria-label="Copy email to clipboard"
                >
                  {copied ? (
                    <Check size={20} strokeWidth={2.5} />
                  ) : (
                    <Copy size={20} strokeWidth={2} />
                  )}
                </motion.button>
              </div>
              {/* Action Buttons */}
              <div className="identity-actions-row">
                <button
                  className="ios-button button-secondary identity-action-btn"
                  onClick={() => setShowConfirm(true)}
                  disabled={syncing}
                >
                  <RefreshCw size={16} className={syncing ? 'spin' : ''} />
                  New Email
                </button>
                <button
                  className="ios-button button-primary identity-action-btn"
                  onClick={() => void checkInbox()}
                  disabled={checking || timeLeft === 'Expired'}
                >
                  {timeLeft === 'Expired' ? (
                    <>
                      <Clock size={16} /> Expired
                    </>
                  ) : (
                    <>
                      <Inbox size={16} />
                      {checking ? 'Syncing...' : 'Sync Inbox'}
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          )}

          {/* Inbox Section */}
          <div
            className="inbox-section-wrapper"
            style={{
              marginTop: variant === 'inbox' ? 0 : 24,
              flex: variant === 'inbox' ? 1 : 'none',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            {syncError && (
              <div className="sync-error-banner" style={{ padding: '8px 12px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', borderRadius: '8px', fontSize: '13px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                <Zap size={14} /> {syncError}
              </div>
            )}
            {variant === 'inbox' ? (
              <motion.div
                className="inbox-section"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  flex: 1,
                  overflow: 'hidden',
                }}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
              >
                {/* Header Row - Matching Dashboard inbox-header-row */}
                <div
                  className="inbox-header-row"
                  style={{
                    marginBottom: 0,
                    paddingBottom: 12,
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                >
                  <div className="inbox-title-group">
                    {/* Back Button - Circular for Navigation */}
                    <motion.button
                      className="action-icon"
                      onClick={onBack}
                      whileTap={{ scale: 0.85 }}
                      title="Go back"
                      style={{
                        marginRight: 8,
                        borderRadius: '50%',
                        width: 32,
                        height: 32,
                      }}
                    >
                      <ChevronLeft size={16} style={{ marginRight: 2 }} />{' '}
                      {/* Optically center arrow */}
                    </motion.button>
                    <Inbox size={20} />
                    <span>Inbox</span>
                    {inbox.length > 0 && <span className="inbox-count">{inbox.length}</span>}
                  </div>
                  {/* Refresh: Just icon with tooltip, shows Syncing... when active */}
                  <motion.button
                    className="action-icon"
                    onClick={() => void checkInbox()}
                    disabled={checking}
                    whileTap={{ scale: 0.85 }}
                    title={checking ? 'Syncing...' : 'Refresh inbox'}
                  >
                    <RefreshCw size={14} className={checking ? 'spin' : ''} />
                  </motion.button>
                </div>

                {/* Email List - Dashboard Style */}
                <div className="inbox-list inbox-list-scroll">
                  {inbox.length > 0 ? (
                    inbox.slice(0, 50).map((item: Email, i: number) => {
                      // Use shared utility functions
                      const verificationCode = extractOTP(item.subject + ' ' + (item.body || ''));
                      const activationLink = extractActivationLink(item.body || '');

                      return (
                        <motion.div
                          key={item.id}
                          className="inbox-item"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.05 }}
                        >
                          <div className="inbox-item-avatar" style={{ position: 'relative' }}>
                            {item.from.charAt(0).toUpperCase()}
                            {!item.read && (
                              <div style={{ position: 'absolute', top: -2, right: -2, width: 8, height: 8, background: 'var(--brand-primary)', borderRadius: '50%', boxShadow: '0 0 0 2px var(--glass-card-bg)' }} title="Unread" />
                            )}
                          </div>
                          <div className="inbox-item-content">
                            <div className="inbox-item-header">
                              <span className="inbox-item-from">{item.from}</span>
                              <span className="inbox-item-date">
                                {formatRelativeTime(getEmailTimestamp(item))}
                              </span>
                            </div>
                            <div className="inbox-item-subject">{item.subject}</div>

                            {/* Capsule Badges for OTP and Links */}
                            <div className="inbox-badges-row">
                              {verificationCode && (
                                <motion.button
                                  className="otp-badge"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void copyToClipboard(verificationCode)
                                      .then(() => {
                                        onToast(`Code ${verificationCode} copied`);
                                      })
                                      .catch(() => {
                                        onToast('Copy failed');
                                      });
                                  }}
                                  whileHover={{ scale: 1.05 }}
                                  whileTap={{ scale: 0.95 }}
                                >
                                  <span className="otp-badge-code">🔢 {verificationCode}</span>
                                  <Copy size={10} />
                                </motion.button>
                              )}
                              {activationLink && (
                                <motion.button
                                  className="link-badge"
                                  onClick={(e) => void openActivationLink(e, activationLink)}
                                  whileHover={{ scale: 1.05 }}
                                  whileTap={{ scale: 0.95 }}
                                >
                                  <span className="otp-badge-code">🔗 Verify Link</span>
                                  <ChevronRight size={10} />
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
                        <Mail size={26} color="var(--brand-primary)" strokeWidth={1.5} />
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
                      // Use shared utility functions
                      const verificationCode = extractOTP(item.subject + ' ' + (item.body || ''));
                      const activationLink = extractActivationLink(item.body || '');

                      return (
                        <motion.div
                          key={item.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.05, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                          className="glass-card inbox-item-default"
                        >
                          {/* Avatar */}
                          <div className="inbox-avatar-default" style={{ position: 'relative' }}>
                            {item.from.charAt(0).toUpperCase()}
                            {!item.read && (
                              <div style={{ position: 'absolute', top: -1, right: -1, width: 8, height: 8, background: 'var(--brand-primary)', borderRadius: '50%', boxShadow: '0 0 0 2px var(--glass-card-bg)' }} title="Unread" />
                            )}
                          </div>

                          {/* Content */}
                          <div className="inbox-content-default">
                            <div className="inbox-header-default">
                              <div className="inbox-from-default truncate">{item.from}</div>
                              <div className="inbox-date-default">
                                {formatRelativeTime(getEmailTimestamp(item))}
                              </div>
                            </div>
                            <div className="inbox-subject-default truncate">{item.subject}</div>

                            {/* Capsule Badges */}
                            <div className="inbox-badges-default">
                              {verificationCode && (
                                <motion.button
                                  className="otp-badge"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void copyToClipboard(verificationCode)
                                      .then(() => {
                                        onToast(`Code ${verificationCode} copied`);
                                      })
                                      .catch(() => {
                                        onToast('Copy failed');
                                      });
                                  }}
                                  whileHover={{ scale: 1.02 }}
                                  whileTap={{ scale: 0.98 }}
                                >
                                  🔢 {verificationCode}
                                  <Copy size={10} />
                                </motion.button>
                              )}
                              {activationLink && (
                                <motion.button
                                  className="link-badge"
                                  onClick={(e) => void openActivationLink(e, activationLink)}
                                  whileHover={{ scale: 1.02 }}
                                  whileTap={{ scale: 0.98 }}
                                >
                                  🔗 Verify Link
                                  <ChevronRight size={10} />
                                </motion.button>
                              )}
                            </div>
                          </div>

                          <ChevronRight size={16} color="var(--text-tertiary)" strokeWidth={2.5} />
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
                            size={28}
                            color="var(--brand-primary)"
                            strokeWidth={1.5}
                            style={{ opacity: 0.6 }}
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
        <div
          className="glass-card missing-identity-card"
          style={{ textAlign: 'center', padding: '32px 20px', marginTop: 16 }}
        >
          <div
            className="shimmer-icon-container"
            style={{ margin: '0 auto 16px', display: 'flex', justifyContent: 'center' }}
          >
            <Mail size={48} color="var(--brand-primary)" style={{ opacity: 0.8 }} />
          </div>
          <h3 style={{ fontSize: 18, marginBottom: 8, color: 'var(--text-primary)' }}>
            {t('identityRequired')}
          </h3>
          <p
            style={{
              fontSize: 14,
              color: 'var(--text-secondary)',
              marginBottom: 24,
              lineHeight: 1.5,
            }}
          >
            {t('generateIdentityMessage')}
          </p>
          <button
            className="ios-button button-primary"
            onClick={onGenerate}
            disabled={syncing}
            style={{ width: '100%', justifyContent: 'center' }}
          >
            {syncing ? <span className="spinner-small" /> : <Zap size={16} fill="white" />}
            {syncing ? t('syncingIdentity') : t('generateIdentity')}
          </button>
        </div>
      )}

      {/* Confirmation Modal overlay */}
      <AnimatePresence>
        {showConfirm && (
          <motion.div 
            className="modal-overlay" 
            onClick={() => setShowConfirm(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ zIndex: 9999, padding: '0 20px', display: 'flex' }}
          >
            <motion.div
              className="glass-card confirmation-modal"
              onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              style={{ margin: 'auto', background: 'var(--bg-primary)', width: '100%', maxWidth: '320px', padding: '24px' }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="modal-title"
            >
              <h3 id="modal-title" style={{ marginTop: 0, marginBottom: '8px', fontSize: '18px', color: 'var(--text-primary)' }}>Generate New Email?</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.5, margin: 0 }}>
                Your current temporary email and its inbox will be permanently lost. Are you sure you want to generate a new one?
              </p>
              <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
                <button 
                  ref={confirmCancelBtnRef}
                  className="ios-button button-secondary" 
                  style={{ flex: 1 }} 
                  onClick={() => setShowConfirm(false)}
                >
                  Cancel
                </button>
                <button 
                  className="ios-button button-primary" 
                  style={{ flex: 1, background: 'var(--error)' }}
                  onClick={() => {
                    setShowConfirm(false);
                    onGenerate();
                  }}
                >
                  Generate
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default EmailGenerator;
