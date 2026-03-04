import { motion, AnimatePresence, Transition } from 'framer-motion';
import { Mail, Copy, RefreshCw, Sparkles, Inbox, Clock, Check, ChevronRight, ChevronLeft, Zap } from 'lucide-react';
import React, { useState, useEffect, useCallback } from 'react';
import { EmailAccount, Email } from '../../types';
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

interface Props {
    onToast: (message: string) => void;
    emailAccount: EmailAccount | null;
    onGenerate: () => void;
    syncing: boolean;
    variant?: 'default' | 'inbox';
    onBack?: () => void;
}

const EmailGenerator: React.FC<Props> = ({ onToast, emailAccount, onGenerate, syncing, variant = 'default', onBack }) => {
    const rawInbox = useStorageSubscription('inbox', []);
    const inbox = Array.isArray(rawInbox) ? rawInbox : [];
    const [checking, setChecking] = useState(false);
    const [copied, setCopied] = useState(false);
    const [lastUpdated, setLastUpdated] = useState<number>(Date.now());
    const [timeLeft, setTimeLeft] = useState<string>('');

    // iOS Spring Transition Config
    const springTransition: Transition = {
        type: "spring",
        stiffness: 260,
        damping: 26,
        mass: 1
    };

    const checkInbox = useCallback(async (showToast = true): Promise<boolean> => {
        if (!emailAccount) { return false; }
        setChecking(true);
        try {
            const response = await safeSendMessage({ action: 'CHECK_INBOX' });
            if (response && response.success) {
                // We rely on useStorageSubscription to update the actual inbox array
                const emails = (response && 'emails' in response && Array.isArray(response.emails)) ? response.emails : [];
                setLastUpdated(Date.now());
                if (showToast) {
                    if (emails.length > 0) {
                        onToast(`${emails.length} new email(s) found`);
                    } else {
                        onToast('Inbox is up to date (0 new)');
                    }
                }
                return true;
            }
            if (showToast) { onToast(response?.error || 'Sync failed: No response'); }
            return false;
        } catch (error) {
            if (showToast) { onToast('Sync failed: Connection lost'); }
            return false;
        } finally {
            setChecking(false);
        }
    }, [emailAccount, onToast]);


    useEffect(() => {
        if (!emailAccount || !emailAccount.expiresAt) { return; }

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
        if (emailAccount) {
            // Initial check without toast
            checkInbox(false);
            // Polling interval removed in favor of background pacemaker polling
        }
    }, [emailAccount, checkInbox]);

    const copyEmail = async () => {
        if (!emailAccount) { return; }
        try {
            await copyToClipboard(emailAccount.fullEmail);
            setCopied(true);
            onToast('Email copied');
            setTimeout(() => setCopied(false), 2500);
        } catch (error) {
            onToast('Copy failed');
        }
    };

    return (
        <div className="generator-flow">
            {emailAccount ? (
                <>
                    {/* Active Identity Card - HIDE IN INBOX VARIANT */}
                    {variant === 'default' && (
                        <motion.div
                            className="glass-card email-generator-card"
                            transition={springTransition}
                        >
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
                                            {checking ? 'Checking...' : syncing ? 'Syncing...' : `Updated ${formatRelativeTime(lastUpdated)}`}
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
                                    <div className="terminal-domain">
                                        @{emailAccount.fullEmail.split('@')[1]}
                                    </div>

                                    {/* Status Badges */}
                                    <div className="identity-status-badges">
                                        <div className="identity-status-temporary">
                                            <div className="identity-status-dot" />
                                            Temporary
                                        </div>
                                        {timeLeft && (
                                            <div className={`identity-status-time ${timeLeft === 'Expired' ? 'identity-status-expired' : ''}`}>
                                                <Clock size={10} strokeWidth={2.5} />
                                                {timeLeft}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <motion.button
                                    className="copy-button"
                                    onClick={copyEmail}
                                    style={{
                                        background: copied ? 'var(--badge-success)' : 'var(--list-item-bg)',
                                        color: copied ? 'var(--success)' : 'var(--text-primary)',
                                    }}
                                    whileTap={{ scale: 0.9 }}
                                    aria-label="Copy email to clipboard"
                                >
                                    {copied ? <Check size={20} strokeWidth={2.5} /> : <Copy size={20} strokeWidth={2} />}
                                </motion.button>
                            </div>
                            {/* Action Buttons */}
                            <div className="identity-actions-row">
                                <button
                                    className="ios-button button-secondary identity-action-btn"
                                    onClick={onGenerate}
                                >
                                    <RefreshCw size={16} />
                                    New Email
                                </button>
                                <button
                                    className="ios-button button-primary identity-action-btn"
                                    onClick={() => checkInbox()}
                                    disabled={checking}
                                >
                                    <Inbox size={16} />
                                    {checking ? 'Syncing...' : 'Sync Inbox'}
                                </button>
                            </div>
                        </motion.div>
                    )}

                    {/* Inbox Section */}
                    <div className="inbox-section-wrapper" style={{ marginTop: variant === 'inbox' ? 0 : 24, flex: variant === 'inbox' ? 1 : 'none' }}>
                        {variant === 'inbox' ? (
                            <motion.div
                                className="inbox-section"
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    flex: 1,
                                    overflow: 'hidden'
                                }}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                            >
                                {/* Header Row - Matching Dashboard inbox-header-row */}
                                <div className="inbox-header-row" style={{ marginBottom: 0, paddingBottom: 12, borderBottom: '1px solid var(--border-subtle)' }}>
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
                                                height: 32
                                            }}
                                        >
                                            <ChevronLeft size={16} style={{ marginRight: 2 }} /> {/* Optically center arrow */}
                                        </motion.button>
                                        <Inbox size={20} />
                                        <span>Inbox</span>
                                        {inbox.length > 0 && (
                                            <span className="inbox-count">{inbox.length}</span>
                                        )}
                                    </div>
                                    {/* Refresh: Just icon with tooltip, shows Syncing... when active */}
                                    <motion.button
                                        className="action-icon"
                                        onClick={() => checkInbox()}
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
                                                    <div className="inbox-item-avatar">
                                                        {item.from.charAt(0).toUpperCase()}
                                                    </div>
                                                    <div className="inbox-item-content">
                                                        <div className="inbox-item-header">
                                                            <span className="inbox-item-from">{item.from}</span>
                                                            <span className="inbox-item-date">{formatRelativeTime((item as any).timestamp || (item.date as any))}</span>
                                                        </div>
                                                        <div className="inbox-item-subject">{item.subject}</div>

                                                        {/* Capsule Badges for OTP and Links */}
                                                        <div className="inbox-badges-row">
                                                            {verificationCode && (
                                                                <motion.button
                                                                    className="otp-badge"
                                                                    onClick={async (e) => {
                                                                        e.stopPropagation();
                                                                        await copyToClipboard(verificationCode);
                                                                        onToast(`Code ${verificationCode} copied`);
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
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        window.open(activationLink, '_blank', 'noopener,noreferrer');
                                                                        onToast('Opening activation link...');
                                                                    }}
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
                                                    <div className="inbox-avatar-default">
                                                        {item.from.charAt(0).toUpperCase()}
                                                    </div>

                                                    {/* Content */}
                                                    <div className="inbox-content-default">
                                                        <div className="inbox-header-default">
                                                            <div className="inbox-from-default truncate">{item.from}</div>
                                                            <div className="inbox-date-default">{formatRelativeTime((item as any).timestamp || (item.date as any))}</div>
                                                        </div>
                                                        <div className="inbox-subject-default truncate">{item.subject}</div>

                                                        {/* Capsule Badges */}
                                                        <div className="inbox-badges-default">
                                                            {verificationCode && (
                                                                <motion.button
                                                                    className="otp-badge"
                                                                    onClick={async (e) => {
                                                                        e.stopPropagation();
                                                                        await copyToClipboard(verificationCode);
                                                                        onToast(`Code ${verificationCode} copied`);
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
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        window.open(activationLink, '_blank', 'noopener,noreferrer');
                                                                        onToast('Opening activation link...');
                                                                    }}
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
                                                    <Inbox size={28} color="var(--brand-primary)" strokeWidth={1.5} style={{ opacity: 0.6 }} />
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
                <div className="glass-card missing-identity-card" style={{ textAlign: 'center', padding: '32px 20px', marginTop: 16 }}>
                    <div className="shimmer-icon-container" style={{ margin: '0 auto 16px', display: 'flex', justifyContent: 'center' }}>
                        <Mail size={48} color="var(--brand-primary)" style={{ opacity: 0.8 }} />
                    </div>
                    <h3 style={{ fontSize: 18, marginBottom: 8, color: 'var(--text-primary)' }}>{t('identityRequired')}</h3>
                    <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 24, lineHeight: 1.5 }}>
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
        </div>
    );
};

export default EmailGenerator;
