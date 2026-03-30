import { motion, AnimatePresence } from 'framer-motion';
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
} from 'lucide-react';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { EmailAccount, Email } from '../../types';
import { TIMING } from '../../utils/constants';
import { formatRelativeTime, extractOTP } from '../../utils/formatters';
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

// Rate limit constants
const RATE_LIMIT_MS = {
  GENERATE_EMAIL: 3000, // 3 seconds between email generations
  CHECK_INBOX: 5000, // 5 seconds between inbox checks
  GENERATE_PASSWORD: 1000, // 1 second between password generations
};

interface Props {
  onNavigate: (tab: 'email' | 'password' | 'otp') => void;
  emailAccount: EmailAccount | null;
  onGenerate: () => void;
  onToast: (message: string) => void;
}

const Hub: React.FC<Props> = ({ onNavigate, emailAccount, onGenerate, onToast }) => {
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
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showConfirmEmail) {setShowConfirmEmail(false);}
    };
    if (showConfirmEmail) {
      window.addEventListener('keydown', handleKey);
      setTimeout(() => cancelBtnRef.current?.focus(), 50);
    }
    return () => window.removeEventListener('keydown', handleKey);
  }, [showConfirmEmail]);

  // Switch to Push-State UI instead of polling
  const rawInbox = useStorageSubscription('inbox', []);
  const inboxEmails = Array.isArray(rawInbox) ? rawInbox : [];

  // Generate strong 16-char password with rate limiting
  const generatePassword = useCallback(async () => {
    setIsGeneratingPassword(true);
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const { lastGeneratePasswordTime } = await chrome.storage.local.get('lastGeneratePasswordTime');
        const lastTime = parseInt(lastGeneratePasswordTime || '0', 10);
        const now = Date.now();
        if (now - lastTime < RATE_LIMIT_MS.GENERATE_PASSWORD) {
          setPasswordCooldown(true);
          setTimeout(() => setPasswordCooldown(false), RATE_LIMIT_MS.GENERATE_PASSWORD - (now - lastTime));
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
    } catch (error) {
      onToast('Failed to generate password');
    } finally {
      setIsGeneratingPassword(false);
    }
  }, [onToast]);

  // Check inbox with rate limiting
  const checkInbox = useCallback(async () => {
    if (!emailAccount) {
      return;
    }

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
    } catch (e) {
      onToast('Failed to sync inbox');
    }
  }, [emailAccount, onToast]);

  useEffect(() => {
    if (!password) {
      void generatePassword();
    }
  }, [generatePassword, password]);

  useEffect(() => {
    void checkInbox();
  }, [checkInbox]);

  // Refs for timeout clearing
  const emailTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const passwordTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generatingEmailTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    };
  }, []);

  // Handlers
  const copyEmail = useCallback(async () => {
    if (!emailAccount) {
      return;
    }

    try {
      await copyToClipboard(emailAccount.fullEmail);
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
  }, [emailAccount, onToast]);

  const copyPassword = useCallback(async () => {
    if (!password) {
      return;
    }

    try {
      await copyToClipboard(password);
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

  const copyOTP = useCallback(async (code: string) => {
    try {
      await copyToClipboard(code);
      onToast(t('codeCopied'));
    } catch {
      onToast(t('copyFailed'));
    }
  }, [onToast]);

  const handleCopyEmail = useCallback(() => {
    void copyEmail();
  }, [copyEmail]);

  const handleCopyPassword = useCallback(() => {
    void copyPassword();
  }, [copyPassword]);

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
            setTimeout(() => setEmailCooldown(false), RATE_LIMIT_MS.GENERATE_EMAIL - (now - lastTime));
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
        generatingEmailTimeoutRef.current = setTimeout(() => setIsGeneratingEmail(false), 2000);
      } catch (err) {
        // silent catch
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

  // formatRelativeTime and extractOTP imported from utils/formatters

  // Animation Variants
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
        delayChildren: 0.1,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20, scale: 0.95 },
    visible: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: {
        type: 'spring' as const,
        stiffness: 260,
        damping: 25,
        mass: 0.8,
      },
    },
  };

  const displayedEmails = React.useMemo(() => {
    return inboxEmails.slice(0, 5).map((email: Email) => ({
      ...email,
      otpCode: extractOTP(email.subject + ' ' + email.body),
    }));
  }, [inboxEmails]);

  return (
    <motion.div
      className="ghost-dashboard"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* ═══════════════════════════════════════════════════════════
                 🎴 IDENTITY CARD - Combined Email & Password
               ═══════════════════════════════════════════════════════════ */}
      <motion.div className="ghost-card identity-card" variants={itemVariants}>
        {/* Email Row */}
        <div className="identity-row">
          <div className="identity-icon">
            <Mail size={18} className="icon-premium" />
          </div>
          <div className="identity-content">
            <span className="identity-label">{t('emailLabel')}</span>
            <span
              className={`identity-value hub-val hub-val-email ${!emailAccount ? 'shimmer' : ''}`}
            >
              {emailAccount?.fullEmail || t('syncingIdentity')}
            </span>
          </div>
          <div className="identity-actions">
            <motion.button
              className={`action-icon ${emailCopied ? 'success' : ''}`}
              onClick={handleCopyEmail}
              whileTap={{ scale: 0.94 }}
              whileHover={{ scale: 1.08 }}
              title="Copy email"
              aria-label="Copy email to clipboard"
            >
              {emailCopied ? <Check size={16} /> : <Copy size={16} />}
            </motion.button>
            <motion.button
              className={`action-icon ${isGeneratingEmail ? 'action-loading' : ''} ${emailCooldown ? 'opacity-50' : ''}`}
              onClick={handleGenerateEmail}
              whileTap={{ scale: 0.94 }}
              whileHover={{ scale: 1.08 }}
              title="New identity"
              aria-label="Generate new identity"
              disabled={isGeneratingEmail || emailCooldown}
            >
              <RefreshCw size={16} className={isGeneratingEmail ? 'spin' : ''} />
            </motion.button>
          </div>
        </div>

        <div className="identity-divider" />

        {/* Password Row */}
        <div className="identity-row">
          <div className="identity-icon password">
            <Lock size={18} className="icon-premium" />
          </div>
          <div className="identity-content">
            <span className="identity-label">{t('passwordLabel')}</span>
            <span className={`identity-value mono hub-val ${!password ? 'shimmer' : ''}`}>
              {!password
                ? t('generatingPassword')
                : showPassword
                  ? password
                  : password.replace(/./g, '•')}
            </span>
          </div>
          <div className="identity-actions">
            <motion.button
              className={`action-icon ${passwordCopied ? 'success' : ''}`}
              onClick={handleCopyPassword}
              whileTap={{ scale: 0.94 }}
              whileHover={{ scale: 1.08 }}
              title="Copy password"
              aria-label="Copy password to clipboard"
            >
              {passwordCopied ? <Check size={16} /> : <Copy size={16} />}
            </motion.button>
            <motion.button
              className="action-icon"
              onClick={() => setShowPassword(!showPassword)}
              whileTap={{ scale: 0.94 }}
              whileHover={{ scale: 1.08 }}
              title={showPassword ? 'Hide' : 'Show'}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </motion.button>
            <div className="action-separator" />
            <motion.button
              className={`action-icon action-danger ${passwordCooldown ? 'opacity-50' : ''}`}
              onClick={handleGeneratePassword}
              whileTap={{ scale: 0.94 }}
              whileHover={{ scale: 1.08 }}
              title="Reset secure password"
              disabled={isGeneratingPassword || passwordCooldown}
            >
              <RefreshCw size={16} className={isGeneratingPassword ? 'spin' : ''} />
            </motion.button>
          </div>
        </div>
      </motion.div>

      {/* ═══════════════════════════════════════════════════════════
                 📥 INBOX WITH EMAIL LIST
               ═══════════════════════════════════════════════════════════ */}
      <motion.div className="inbox-section" variants={itemVariants}>
        <div className="inbox-header-row">
          <div className="inbox-title-group">
            <Inbox size={20} />
            <span>{t('recentMessages')}</span>
            {inboxEmails.length > 0 && <span className="inbox-count">{inboxEmails.length}</span>}
          </div>
          <motion.button
            className="view-all-btn"
            onClick={() => {
              if (inboxEmails.length > 0) {
                onNavigate('email');
              }
            }}
            disabled={inboxEmails.length === 0}
            whileHover={inboxEmails.length > 0 ? { x: 2 } : {}}
            style={inboxEmails.length === 0 ? { opacity: 0.5, cursor: 'default' } : {}}
          >
            {inboxEmails.length > 0 ? (
              <>
                {t('fullInbox')} <ChevronRight size={14} />
              </>
            ) : (
              t('scanning')
            )}
          </motion.button>
        </div>

        <div className="inbox-list">
          {inboxEmails.length === 0 ? (
            <div className="shimmer hub-empty-state">
              <Mail size={16} strokeWidth={1.5} className="spin-slow" />
              <span>{t('listening')}</span>
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
                    whileHover={{ x: 4, background: 'var(--list-item-hover)' }}
                  >
                    <div className="inbox-item-avatar">{emailItem.from.charAt(0).toUpperCase()}</div>
                    <div className="inbox-item-content">
                      <div className="inbox-item-header">
                        <span className="inbox-item-from">{emailItem.from}</span>
                        <span className="inbox-item-date">
                          <Clock size={10} />
                          {formatRelativeTime(new Date(emailItem.date).getTime())}
                        </span>
                      </div>
                      <div className="inbox-item-subject">{emailItem.subject}</div>
                      {emailItem.otpCode && (
                        <motion.button
                          className="otp-badge"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (emailItem.otpCode) {
                                handleCopyOTP(emailItem.otpCode);
                            }
                          }}
                          whileHover={{
                            scale: 1.05,
                            boxShadow: '0 0 15px rgba(99, 102, 241, 0.4)',
                          }}
                          whileTap={{ scale: 0.95 }}
                        >
                          <span className="otp-badge-code">{emailItem.otpCode}</span>
                          <Copy size={10} />
                        </motion.button>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </motion.div>

      {/* Confirmation Modal overlay (Replaces window.confirm H4) */}
      <AnimatePresence>
        {showConfirmEmail && (
          <motion.div 
            className="modal-overlay" 
            onClick={() => setShowConfirmEmail(false)}
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
              aria-labelledby="hub-modal-title"
            >
              <h3 id="hub-modal-title" style={{ marginTop: 0, marginBottom: '8px', fontSize: '18px', color: 'var(--text-primary)' }}>Generate New Email?</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.5, margin: 0 }}>
                Your current temporary email and its inbox will be permanently lost.
              </p>
              <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
                <motion.button 
                  ref={cancelBtnRef}
                  className="ios-button button-secondary" 
                  style={{ flex: 1 }} 
                  onClick={() => setShowConfirmEmail(false)}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.96 }}
                >
                  Cancel
                </motion.button>
                <motion.button 
                  className="ios-button button-primary" 
                  style={{ flex: 1, background: 'var(--error)' }}
                  onClick={executeGenerateEmail}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.96 }}
                >
                  Generate
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default Hub;
