import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, Lock, Copy, RefreshCw, Check, Inbox, ChevronRight, Eye, EyeOff, Clock } from 'lucide-react';
import { EmailAccount, LastOTP, Email } from '../../types';
import { safeSendMessage } from '../../utils/messaging';
import { formatRelativeTime, extractOTP } from '../../utils/formatters';
import { TIMING } from '../../utils/constants';

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
    const [lastOTPCode, setLastOTPCode] = useState<string | null>(null);
    const [hasNewOTP, setHasNewOTP] = useState(false);
    const [inboxEmails, setInboxEmails] = useState<Email[]>([]);

    // Generate strong 16-char password
    const generatePassword = useCallback(async () => {
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

    // Check for OTP
    const checkForNewOTP = useCallback(async () => {
        try {
            const response = await safeSendMessage({ action: 'GET_LAST_OTP' });
            if (response && 'lastOTP' in response && response.lastOTP) {
                const otp = response.lastOTP as LastOTP;
                if (otp.code !== lastOTPCode) {
                    setLastOTPCode(otp.code);
                    if (Date.now() - otp.extractedAt < TIMING.OTP_NEW_THRESHOLD_MS) setHasNewOTP(true);
                }
            }
        } catch (e) {
            console.debug('[Hub] OTP check failed:', e);
        }
    }, [lastOTPCode]);

    // Check inbox and get emails
    const checkInbox = useCallback(async () => {
        try {
            const response = await safeSendMessage({ action: 'CHECK_INBOX' });
            if (response && 'emails' in response && response.emails) {
                setInboxEmails(response.emails as Email[]);
            }
        } catch (e) {
            // Silent fail for inbox check - will retry
        }
    }, []);

    useEffect(() => {
        if (!password) generatePassword();
        checkForNewOTP();
        checkInbox();
        const interval = setInterval(() => { checkForNewOTP(); checkInbox(); }, TIMING.HUB_POLL_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [generatePassword, checkForNewOTP, checkInbox, password]);

    // Handlers
    const copyEmail = async () => {
        if (!emailAccount) return;
        await navigator.clipboard.writeText(emailAccount.fullEmail);
        setEmailCopied(true);
        onToast('Email copied!');
        setTimeout(() => setEmailCopied(false), TIMING.COPY_CONFIRMATION_MS);
    };

    const copyPassword = async () => {
        if (!password) return;
        await navigator.clipboard.writeText(password);
        setPasswordCopied(true);
        onToast('Password copied!');
        setTimeout(() => setPasswordCopied(false), TIMING.COPY_CONFIRMATION_MS);
    };

    const copyOTP = async (code: string) => {
        await navigator.clipboard.writeText(code);
        onToast('Code copied!');
    };

    // formatRelativeTime and extractOTP imported from utils/formatters

    return (
        <div className="ghost-dashboard">
            {/* ═══════════════════════════════════════════════════════════
                🎴 IDENTITY CARD - Combined Email & Password
               ═══════════════════════════════════════════════════════════ */}
            <div className="identity-card">
                {/* Email Row */}
                <div className="identity-row">
                    <div className="identity-icon">
                        <Mail size={18} className="icon-premium" />
                    </div>
                    <div className="identity-content">
                        <span className="identity-label">Email</span>
                        <span className="identity-value">
                            {emailAccount?.fullEmail || 'Generating...'}
                        </span>
                    </div>
                    <div className="identity-actions">
                        <motion.button
                            className={`action-icon ${emailCopied ? 'success' : ''}`}
                            onClick={copyEmail}
                            whileTap={{ scale: 0.85 }}
                            title="Copy email"
                            aria-label="Copy email to clipboard"
                        >
                            {emailCopied ? <Check size={16} /> : <Copy size={16} />}
                        </motion.button>
                        <motion.button
                            className="action-icon"
                            onClick={onGenerate}
                            whileTap={{ scale: 0.85 }}
                            title="New email"
                            aria-label="Generate new email"
                        >
                            <RefreshCw size={16} />
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
                            Password

                        </span>
                        <span className="identity-value mono">
                            {showPassword ? password : '••••••••••••••••'}
                        </span>
                    </div>
                    <div className="identity-actions">
                        <motion.button
                            className={`action-icon ${passwordCopied ? 'success' : ''}`}
                            onClick={copyPassword}
                            whileTap={{ scale: 0.85 }}
                            title="Copy password"
                            aria-label="Copy password to clipboard"
                        >
                            {passwordCopied ? <Check size={16} /> : <Copy size={16} />}
                        </motion.button>
                        <motion.button
                            className="action-icon"
                            onClick={() => setShowPassword(!showPassword)}
                            whileTap={{ scale: 0.85 }}
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
                            title="Generate new password (current will be lost!)"
                            disabled={isGeneratingPassword}
                        >
                            <RefreshCw size={16} className={isGeneratingPassword ? 'spin' : ''} />
                        </motion.button>
                    </div>
                </div>
            </div>

            {/* ═══════════════════════════════════════════════════════════
                📥 INBOX WITH EMAIL LIST
               ═══════════════════════════════════════════════════════════ */}
            <div className="inbox-section">
                <div className="inbox-header-row">
                    <div className="inbox-title-group">
                        <Inbox size={20} />
                        <span>Inbox</span>
                        {inboxEmails.length > 0 && (
                            <span className="inbox-count">{inboxEmails.length}</span>
                        )}
                    </div>
                    <motion.button
                        className="view-all-btn"
                        onClick={() => {
                            if (inboxEmails.length > 0) onNavigate('email');
                        }}
                        disabled={inboxEmails.length === 0}
                        whileHover={inboxEmails.length > 0 ? { x: 2 } : {}}
                        style={inboxEmails.length === 0 ? { opacity: 0.5, cursor: 'default' } : {}}
                    >
                        {inboxEmails.length > 0 ? (
                            <>View All <ChevronRight size={14} /></>
                        ) : (
                            'No Messages'
                        )}
                    </motion.button>
                </div>

                <div className="inbox-list">
                    {inboxEmails.length === 0 ? (
                        /* COLLAPSED: Empty state is just a single line */
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '16px 0',
                            gap: 8,
                            color: 'var(--text-tertiary)',
                            fontSize: 13
                        }}>
                            <Mail size={16} strokeWidth={1.5} />
                            <span>No messages yet</span>
                        </div>
                    ) : (
                        inboxEmails.slice(0, 2).map((email, index) => {
                            const otpCode = extractOTP(email.subject + ' ' + email.body);
                            return (
                                <motion.div
                                    key={email.id || index}
                                    className="inbox-item"
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: index * 0.05 }}
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
                                                whileHover={{ scale: 1.05 }}
                                                whileTap={{ scale: 0.95 }}
                                            >
                                                <span className="otp-badge-code">{otpCode}</span>
                                                <Copy size={10} />
                                            </motion.button>
                                        )}
                                    </div>
                                </motion.div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
};

export default Hub;
