import { motion, AnimatePresence } from 'framer-motion';
import {
  Mail,
  Copy,
  RefreshCw,
  Inbox,
  Clock,
  ChevronRight,
  ChevronLeft,
  Zap,
  Hash,
} from 'lucide-react';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { EmailAccount, Email } from '../../../types';
import {
  formatRelativeTime,
  copyToClipboard,
  openSafeUrl,
  contentToString,
} from '../../../utils/core';
import { getSenderLabel } from '../../../utils/emailIdentity';
import { safeSendMessage } from '../../../utils/messaging';
import { t } from '../../i18n';
import { Button, tweenSurface } from '../../ui';
import { useOTPExtractor, useStorageSubscription } from '../hooks';
import { ConfirmModal, EmailAvatar, EmailViewerModal, getEmailPreview } from './SharedComponents';

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

function getEmailTimestamp(email: Email): number | null {
  const timestamp =
    typeof email.date === 'number' ? email.date : Date.parse(String(email.date ?? ''));
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
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

  // Local email viewer state (declared after the extractor maps above —
  // the opener below reads them, so order matters).
  const [viewerEmail, setViewerEmail] = useState<Email | null>(null);
  const [viewerOtp, setViewerOtp] = useState<string | null>(null);
  const [viewerLink, setViewerLink] = useState<string | null>(null);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);
  const viewerSeqRef = useRef(0);

  const openEmailInViewer = useCallback(
    async (item: Email) => {
      const seq = ++viewerSeqRef.current;
      const currentId = String(item.id);
      setViewerEmail(item);
      setViewerError(null);
      setViewerOtp(emailOTPs[item.id] ?? null);
      setViewerLink(emailLinks[item.id] ?? null);
      setViewerLoading(true);
      try {
        if (!emailAccount?.fullEmail || !emailAccount.fullEmail.includes('@')) {
          throw new Error('No active email account');
        }
        const [login = '', domain = ''] = emailAccount.fullEmail.split('@');
        const res = (await safeSendMessage({
          action: 'READ_EMAIL',
          payload: { emailId: currentId, login, domain, service: emailAccount.service },
        })) as { success?: boolean; email?: Email; error?: unknown } | null;
        if (viewerSeqRef.current !== seq) {
          return;
        }
        if (res?.success && res.email) {
          const full = res.email;
          setViewerEmail((prev) => (prev && String(prev.id) === currentId ? full : prev));
          const extract = (await safeSendMessage({
            action: 'EXTRACT_OTP',
            payload: {
              subject: contentToString(full.subject ?? item.subject),
              text: contentToString(full.body ?? item.body),
              textBody: contentToString(full.body ?? item.body),
              htmlBody: contentToString((full as Email).htmlBody ?? (item as Email).htmlBody),
              source: 'popup-viewer',
              emailId: currentId,
              emailFrom: contentToString(full.from ?? item.from),
            },
          })) as { success?: boolean; otp?: unknown; link?: unknown } | null;
          if (viewerSeqRef.current !== seq) {
            return;
          }
          if (extract?.success) {
            setViewerOtp(typeof extract.otp === 'string' && extract.otp ? extract.otp : null);
            setViewerLink(typeof extract.link === 'string' && extract.link ? extract.link : null);
          }
        } else if (res?.error) {
          setViewerError(typeof res.error === 'string' ? res.error : 'Could not load message');
        } else {
          setViewerError('Could not load message');
        }
      } catch (err) {
        if (viewerSeqRef.current === seq) {
          setViewerError(err instanceof Error ? err.message : 'Failed to load message');
        }
      } finally {
        if (viewerSeqRef.current === seq) {
          setViewerLoading(false);
        }
      }
    },

    [emailAccount?.fullEmail, emailAccount?.service, emailOTPs, emailLinks]
  );

  const closeViewer = useCallback(() => {
    viewerSeqRef.current += 1;
    setViewerEmail(null);
    setViewerError(null);
    setViewerOtp(null);
    setViewerLink(null);
    setViewerLoading(false);
  }, []);

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
      onToast('Opening activation link…');
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
            <motion.div className="memphis-card email-generator-card" transition={tweenSurface}>
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
                      transition={tweenSurface}
                      className="identity-sync-text"
                    >
                      <RefreshCw size={12} className={checking || syncing ? 'spin' : ''} />
                      {checking
                        ? 'Checking…'
                        : syncing
                          ? 'Syncing…'
                          : `Updated ${formatRelativeTime(lastUpdated)}`}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>

              <div className="identity-content-wrapper">
                <div className="identity-email-info">
                  {/* Email Display - Terminal Style */}
                  <div className="terminal-prefix">
                    {emailAccount.fullEmail.split('@')[0] ?? ''}
                  </div>
                  <div className="terminal-domain">
                    @{emailAccount.fullEmail.split('@')[1] ?? ''}
                  </div>

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
                  type="button"
                  className={`copy-button ${copySuccess ? 'copy-success' : ''}`}
                  onClick={() => void copyEmail()}
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
                  New email
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
                      {checking ? 'Refreshing…' : 'Refresh inbox'}
                    </>
                  )}
                </Button>
              </div>
            </motion.div>
          )}

          {/* Inbox Section */}
          <div
            className={`inbox-section-wrapper${variant === 'inbox' ? ' inbox-section-wrapper--inbox hub-email-panel' : ''}`}
          >
            {syncError && (
              <div className="inbox-error-banner" role="alert">
                <Zap size={14} /> {syncError}
              </div>
            )}
            {variant === 'inbox' ? (
              <motion.div
                className="inbox-section email-inbox-flex"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={tweenSurface}
              >
                {/* Header Row - Matching Dashboard inbox-header-row */}
                <div className="inbox-header-row email-inbox-header">
                  <div className="inbox-title-group">
                    {/* Back Button - Circular for Navigation */}
                    <motion.button
                      type="button"
                      className="action-icon email-back-btn"
                      onClick={onBack}
                      title="Go back"
                      aria-label="Go back to dashboard"
                    >
                      <ChevronLeft size={18} />
                    </motion.button>
                    <Inbox size={22} />
                    <span>Inbox</span>
                    {inbox.length > 0 && <span className="inbox-count">{inbox.length}</span>}
                  </div>
                  {/* Refresh: Just icon with tooltip, shows Syncing… when active */}
                  <motion.button
                    type="button"
                    className="action-icon"
                    onClick={() => void checkInbox()}
                    disabled={checking}
                    aria-busy={checking}
                    title={checking ? 'Syncing…' : 'Refresh inbox'}
                    aria-label="Refresh inbox"
                  >
                    <RefreshCw size={16} className={checking ? 'spin' : ''} />
                  </motion.button>
                </div>

                {/* Announce meaningful inbox changes without making the full list live. */}
                <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                  {latestInbox.length > 0
                    ? `${latestInbox.length} message${latestInbox.length === 1 ? '' : 's'} in inbox`
                    : 'No messages in inbox'}
                </div>
                {/* Email List - Dashboard Style */}
                <div className="inbox-list inbox-list-scroll">
                  {latestInbox.length > 0 ? (
                    latestInbox.map((item: Email) => {
                      // Use shared utility functions
                      const verificationCode =
                        emailOTPs[item.id] !== undefined ? emailOTPs[item.id] : undefined;
                      const activationLink = emailLinks[item.id] || null;
                      const emailTimestamp = getEmailTimestamp(item);
                      const preview = getEmailPreview(item.snippet || item.textBody || item.body);
                      const senderLabel = getSenderLabel(
                        item.from,
                        item.subject,
                        activationLink,
                        item.htmlBody || item.textBody || item.body || item.snippet
                      );

                      return (
                        <div key={item.id} className="inbox-item" data-unread={!item.read}>
                          <EmailAvatar
                            from={item.from}
                            subject={item.subject}
                            website={activationLink}
                            content={item.htmlBody || item.textBody || item.body || item.snippet}
                            className="inbox-item-avatar"
                          />
                          <div className="inbox-item-content">
                            <div className="inbox-item-header">
                              <span className="inbox-item-from" {...getLangAttr(item.from)}>
                                {!item.read && (
                                  <span className="inbox-unread-dot" aria-hidden="true" />
                                )}
                                <span className="inbox-sender-name">{senderLabel}</span>
                              </span>
                              <span className="inbox-item-date">
                                {emailTimestamp === null
                                  ? 'Date unavailable'
                                  : formatRelativeTime(emailTimestamp)}
                              </span>
                            </div>
                            <div className="inbox-item-subject" {...getLangAttr(item.subject)}>
                              {item.subject}
                            </div>
                            {preview && !verificationCode && !activationLink && (
                              <div className="inbox-item-preview">{preview}</div>
                            )}

                            {/* Capsule Badges for OTP and Links */}
                            <div className="inbox-badges-row">
                              {verificationCode && (
                                <motion.button
                                  type="button"
                                  className="otp-badge"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void copyCode(verificationCode);
                                  }}
                                  aria-label={`Copy verification code ${verificationCode}`}
                                >
                                  <span className="inbox-action-label" aria-hidden="true">
                                    Code
                                  </span>
                                  <span className="otp-badge-code">{verificationCode}</span>
                                  <Copy size={12} aria-hidden="true" />
                                </motion.button>
                              )}
                              {activationLink && (
                                <motion.button
                                  type="button"
                                  className="link-badge"
                                  onClick={(e) => void openActivationLink(e, activationLink)}
                                  aria-label="Open verification link"
                                >
                                  <span className="otp-badge-code">Open link</span>
                                  <ChevronRight size={12} />
                                </motion.button>
                              )}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="inbox-item-open-button"
                            aria-label={`${item.read ? 'Open email' : 'Open unread email'} from ${senderLabel}: ${item.subject}`}
                            onClick={() => void openEmailInViewer(item)}
                          >
                            <ChevronRight
                              size={14}
                              className="inbox-item-open-chevron"
                              aria-hidden="true"
                            />
                          </button>
                        </div>
                      );
                    })
                  ) : (
                    <div className="hub-empty-state hub-empty-state--ready">
                      <span className="inbox-empty-art" aria-hidden="true">
                        <Inbox size={26} strokeWidth={1.4} />
                      </span>
                      <span className="hub-empty-copy">
                        <strong>{t('inboxWaitingTitle')}</strong>
                        <span>{t('inboxWaitingDescription')}</span>
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
                    inbox.slice(0, 50).map((item: Email) => {
                      // Use intelligently extracted payload maps
                      const verificationCode = emailOTPs[item.id] || null;
                      const activationLink = emailLinks[item.id] || null;
                      const emailTimestamp = getEmailTimestamp(item);
                      const senderLabel = getSenderLabel(
                        item.from,
                        item.subject,
                        activationLink,
                        item.htmlBody || item.textBody || item.body || item.snippet
                      );

                      return (
                        <div key={item.id} className="inbox-item-default">
                          {/* Avatar */}
                          <EmailAvatar
                            from={item.from}
                            subject={item.subject}
                            website={activationLink}
                            content={item.htmlBody || item.textBody || item.body || item.snippet}
                            className="inbox-item-avatar"
                          >
                            {!item.read && (
                              <div className="unread-dot" title="Unread" aria-hidden="true" />
                            )}
                          </EmailAvatar>

                          {/* Content */}
                          <div className="inbox-content-default">
                            <div className="inbox-header-default">
                              <div
                                className="inbox-from-default truncate"
                                {...getLangAttr(item.from)}
                              >
                                {senderLabel}
                              </div>
                              <div className="inbox-date-default">
                                {emailTimestamp === null
                                  ? 'Date unavailable'
                                  : formatRelativeTime(emailTimestamp)}
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
                                  type="button"
                                  className="otp-badge"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void copyCode(verificationCode);
                                  }}
                                  aria-label={`Copy verification code ${verificationCode}`}
                                >
                                  <Hash size={12} aria-hidden="true" />
                                  <span className="otp-badge-code">{verificationCode}</span>
                                  <Copy size={12} aria-hidden="true" />
                                </motion.button>
                              )}
                              {activationLink && (
                                <motion.button
                                  type="button"
                                  className="link-badge"
                                  onClick={(e) => void openActivationLink(e, activationLink)}
                                  aria-label="Open verification link"
                                >
                                  Verify Link
                                  <ChevronRight size={12} />
                                </motion.button>
                              )}
                            </div>
                          </div>

                          <button
                            type="button"
                            className="inbox-item-open-button"
                            aria-label={`${item.read ? 'Open email' : 'Open unread email'} from ${senderLabel}: ${item.subject}`}
                            onClick={() => void openEmailInViewer(item)}
                          >
                            <ChevronRight
                              size={14}
                              className="inbox-item-open-chevron"
                              aria-hidden="true"
                            />
                          </button>
                        </div>
                      );
                    })
                  ) : (
                    <div className="inbox-empty-card">
                      <div className="inbox-empty-container">
                        <div className="inbox-empty-icon">
                          <Inbox size={32} strokeWidth={1.5} className="email-empty-icon" />
                        </div>
                        <div className="inbox-empty-title">Inbox is Empty</div>
                        <div className="inbox-empty-desc">
                          Messages will appear here when received.
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      ) : (
        <div className="memphis-card missing-identity-card">
          <div className="missing-identity-icon-box">
            <Mail size={52} color="var(--gf-primary)" className="icon-faded" />
          </div>
          <h3 className="missing-identity-title">{t('identityRequired')}</h3>
          <p className="no-identity-desc">{t('generateIdentityMessage')}</p>
          <Button
            variant="primary"
            className="generate-identity-btn"
            onClick={onGenerate}
            loading={syncing}
            leftIcon={<Zap size={18} fill="white" />}
          >
            {syncing ? t('syncingIdentity') : t('generateIdentity')}
          </Button>
        </div>
      )}

      <ConfirmModal
        isOpen={showConfirm}
        title="Generate a new email?"
        message="Your current temporary email and its inbox will be permanently lost. This action cannot be undone."
        confirmText="Generate email"
        cancelText="Cancel"
        onConfirm={() => {
          setShowConfirm(false);
          onGenerate();
        }}
        onCancel={() => setShowConfirm(false)}
        isDestructive={true}
      />

      <EmailViewerModal
        messageKey={viewerEmail ? String(viewerEmail.id) : null}
        message={
          viewerEmail
            ? {
                subject: viewerEmail.subject,
                from: viewerEmail.from,
                date: viewerEmail.date,
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
        onClose={closeViewer}
        onToast={onToast}
      />
    </div>
  );
};

export default EmailGenerator;
