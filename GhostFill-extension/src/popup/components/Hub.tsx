import { motion } from 'framer-motion';
import { Mail, Lock, Copy, RefreshCw, Check, Inbox, ChevronRight, Eye, EyeOff, Clock } from 'lucide-react';
import React, { useState, useEffect, useCallback } from 'react';
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
    GENERATE_EMAIL: 3000,    // 3 seconds between email generations
    CHECK_INBOX: 5000,      // 5 seconds between inbox checks
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

    // Switch to Push-State UI instead of polling
    const rawInbox = useStorageSubscription('inbox', []);
    const inboxEmails = Array.isArray(rawInbox) ? rawInbox : [];

    // Generate strong 16-char password with rate limiting
    const generatePassword = useCallback(async () => {
        const lastTime = parseInt(localStorage.getItem('lastGeneratePasswordTime') || '0', 10);
        const now = Date.now();
        if (now - lastTime < RATE_LIMIT_MS.GENERATE_PASSWORD) {
            return; // Rate limited
        }
        localStorage.setItem('lastGeneratePasswordTime', now.toString());

        setIsGeneratingPassword(true);
        try {
            const response = await safeSendMessage({
                action: 'GENERATE_PASSWORD',
                payload: { length: 16, uppercase: true, lowercase: true, numbers: true, symbols: true }
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
        const lastTime = parseInt(localStorage.getItem('lastCheckInboxTime') || '0', 10);
        const now = Date.now();
        if (now - lastTime < RATE_LIMIT_MS.CHECK_INBOX) {
            return; // Rate limited
        }
        localStorage.setItem('lastCheckInboxTime', now.toString());

        try {
            await safeSendMessage({ action: 'CHECK_INBOX' });
        } catch (e) {
            // Silent fail for inbox check
        }
    }, []);

    useEffect(() => {
        if (!password) { generatePassword(); }
        checkInbox();
        // setInterval polling removed entirely in favor of Push-State reactive architecture!
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [generatePassword, checkInbox, password]);

    // Handlers
    const copyEmail = async () => {
        if (!emailAccount) { return; }
        await copyToClipboard(emailAccount.fullEmail);
        setEmailCopied(true);
        onToast(t('emailCopied'));
        setTimeout(() => setEmailCopied(false), TIMING.COPY_CONFIRMATION_MS);
    };

    const copyPassword = async () => {
        if (!password) { return; }
        await copyToClipboard(password);
        setPasswordCopied(true);
        onToast(t('passwordCopied'));
        setTimeout(() => setPasswordCopied(false), TIMING.COPY_CONFIRMATION_MS);
    };

    const copyOTP = async (code: string) => {
        await copyToClipboard(code);
        onToast(t('codeCopied'));
    };

    // formatRelativeTime and extractOTP imported from utils/formatters

    // Animation Variants
    const containerVariants = {
        hidden: { opacity: 0 },
        visible: {
            opacity: 1,
            transition: {
                staggerChildren: 0.1,
                delayChildren: 0.1
            }
        }
    };

    const itemVariants = {
        hidden: { opacity: 0, y: 20, scale: 0.95 },
        visible: {
            opacity: 1,
            y: 0,
            scale: 1,
            transition: {
                type: 'spring' as const,
                damping: 20,
                stiffness: 100
            }
        }
    };

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
            <motion.div className="identity-card" variants={itemVariants}>
                {/* Email Row */}
                <div className="identity-row">
                    <div className="identity-icon">
                        <Mail size={18} className="icon-premium" />
                    </div>
                    <div className="identity-content">
                        <span className="identity-label">{t('emailLabel')}</span>
                        <span className={`identity-value hub-val hub-val-email ${!emailAccount ? 'shimmer' : ''}`}>
                            {emailAccount?.fullEmail || t('syncingIdentity')}
                        </span>
                    </div>
                    <div className="identity-actions">
                        <motion.button
                            className={`action-icon ${emailCopied ? 'success' : ''}`}
                            onClick={copyEmail}
                            whileTap={{ scale: 0.85 }}
                            whileHover={{ scale: 1.1 }}
                            title="Copy email"
                            aria-label="Copy email to clipboard"
                        >
                            {emailCopied ? <Check size={16} /> : <Copy size={16} />}
                        </motion.button>
                        <motion.button
                            className={`action-icon ${isGeneratingEmail ? 'action-loading' : ''}`}
                            onClick={() => {
                                const now = Date.now();
                                const lastTime = parseInt(localStorage.getItem('lastGenerateEmailTime') || '0', 10);
                                if (now - lastTime < RATE_LIMIT_MS.GENERATE_EMAIL) {
                                    onToast('Please wait before generating a new email');
                                    return;
                                }
                                localStorage.setItem('lastGenerateEmailTime', now.toString());
                                setIsGeneratingEmail(true);
                                onGenerate();
                                setTimeout(() => setIsGeneratingEmail(false), 2000);
                            }}
                            whileTap={{ scale: 0.85 }}
                            whileHover={{ scale: 1.1 }}
                            title="New identity"
                            aria-label="Generate new identity"
                            disabled={isGeneratingEmail}
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
                        <span className="identity-label">
                            {t('passwordLabel')}
                        </span>
                        <span className={`identity-value mono hub-val ${!password ? 'shimmer' : ''}`}>
                            {!password ? t('generatingPassword') : (showPassword ? password : password.replace(/./g, '•'))}
                        </span>
                    </div>
                    <div className="identity-actions">
                        <motion.button
                            className={`action-icon ${passwordCopied ? 'success' : ''}`}
                            onClick={copyPassword}
                            whileTap={{ scale: 0.85 }}
                            whileHover={{ scale: 1.1 }}
                            title="Copy password"
                            aria-label="Copy password to clipboard"
                        >
                            {passwordCopied ? <Check size={16} /> : <Copy size={16} />}
                        </motion.button>
                        <motion.button
                            className="action-icon"
                            onClick={() => setShowPassword(!showPassword)}
                            whileTap={{ scale: 0.85 }}
                            whileHover={{ scale: 1.1 }}
                            title={showPassword ? "Hide" : "Show"}
                            aria-label={showPassword ? "Hide password" : "Show password"}
                        >
                            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </motion.button>
                        <div className="action-separator" />
                        <motion.button
                            className="action-icon action-danger"
                            onClick={() => generatePassword()}
                            whileTap={{ scale: 0.85 }}
                            whileHover={{ scale: 1.1 }}
                            title="Reset secure password"
                            disabled={isGeneratingPassword}
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
                        {inboxEmails.length > 0 && (
                            <span className="inbox-count">{inboxEmails.length}</span>
                        )}
                    </div>
                    <motion.button
                        className="view-all-btn"
                        onClick={() => {
                            if (inboxEmails.length > 0) { onNavigate('email'); }
                        }}
                        disabled={inboxEmails.length === 0}
                        whileHover={inboxEmails.length > 0 ? { x: 2 } : {}}
                        style={inboxEmails.length === 0 ? { opacity: 0.5, cursor: 'default' } : {}}
                    >
                        {inboxEmails.length > 0 ? (
                            <>{t('fullInbox')} <ChevronRight size={14} /></>
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
                            {inboxEmails.slice(0, 5).map((email: Email, index: number) => {
                                const otpCode = extractOTP(email.subject + ' ' + email.body);
                                return (
                                    <motion.div
                                        key={email.id}
                                        className="inbox-item"
                                        initial={{ opacity: 0, x: -10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: 0.3 + (index * 0.1) }}
                                        whileHover={{ x: 4, background: 'var(--list-item-hover)' }}
                                    >
                                        <div className="inbox-item-avatar">
                                            {email.from.charAt(0).toUpperCase()}
                                        </div>
                                        <div className="inbox-item-content">
                                            <div className="inbox-item-header">
                                                <span className="inbox-item-from">{email.from}</span>
                                                <span className="inbox-item-date">
                                                    <Clock size={10} />
                                                    {formatRelativeTime(new Date(email.date).getTime())}
                                                </span>
                                            </div>
                                            <div className="inbox-item-subject">{email.subject}</div>
                                            {otpCode && (
                                                <motion.button
                                                    className="otp-badge"
                                                    onClick={(e) => { e.stopPropagation(); copyOTP(otpCode); }}
                                                    whileHover={{ scale: 1.05, boxShadow: '0 0 15px rgba(99, 102, 241, 0.4)' }}
                                                    whileTap={{ scale: 0.95 }}
                                                >
                                                    <span className="otp-badge-code">{otpCode}</span>
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
        </motion.div>
    );
};

export default Hub;
