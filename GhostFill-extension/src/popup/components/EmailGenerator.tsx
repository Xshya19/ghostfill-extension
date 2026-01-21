import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, Transition } from 'framer-motion';
import { Mail, Copy, RefreshCw, Sparkles, Inbox, Clock, Check, ChevronRight, ChevronLeft } from 'lucide-react';
import { EmailAccount, Email } from '../../types';
import { formatRelativeTime, extractOTP, extractActivationLink } from '../../utils/formatters';
import { safeSendMessage } from '../../utils/messaging';
import { TIMING } from '../../utils/constants';

interface Props {
    onToast: (message: string) => void;
    emailAccount: EmailAccount | null;
    onGenerate: () => void;
    syncing: boolean;
    variant?: 'default' | 'inbox';
    onBack?: () => void;
}

const EmailGenerator: React.FC<Props> = ({ onToast, emailAccount, onGenerate, syncing, variant = 'default', onBack }) => {
    const [inbox, setInbox] = useState<Email[]>([]);
    const [checking, setChecking] = useState(false);
    const [copied, setCopied] = useState(false);
    const [lastUpdated, setLastUpdated] = useState<number>(Date.now());
    const [refreshing, setRefreshing] = useState(false);
    const [timeLeft, setTimeLeft] = useState<string>('');

    // iOS Spring Transition Config
    const springTransition: Transition = {
        type: "spring",
        stiffness: 260,
        damping: 26,
        mass: 1
    };

    const checkInbox = useCallback(async (showToast = true): Promise<boolean> => {
        if (!emailAccount) return false;
        setChecking(true);
        setRefreshing(true);
        try {
            const response = await safeSendMessage({ action: 'CHECK_INBOX' });
            if (response && response.success) {
                const emails = (response && 'emails' in response && Array.isArray(response.emails)) ? response.emails : [];
                setInbox(emails);
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
            if (showToast) onToast(response?.error || 'Sync failed: No response');
            return false;
        } catch (error) {
            if (showToast) onToast('Sync failed: Connection lost');
            return false;
        } finally {
            setChecking(false);
            setTimeout(() => setRefreshing(false), 800);
        }
    }, [emailAccount, onToast]);


    useEffect(() => {
        if (!emailAccount || !emailAccount.expiresAt) return;

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
            const interval = setInterval(() => checkInbox(false), TIMING.INBOX_POLL_INTERVAL_MS);
            return () => clearInterval(interval);
        }
    }, [emailAccount, checkInbox]);

    const copyEmail = async () => {
        if (!emailAccount) return;
        try {
            await navigator.clipboard.writeText(emailAccount.fullEmail);
            setCopied(true);
            onToast('Email copied');
            setTimeout(() => setCopied(false), 2000);
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
                            className="glass-card"
                            style={{
                                padding: '24px',
                                background: 'var(--card-inner-bg)',
                                border: '1px solid rgba(255, 255, 255, 0.5)',
                                position: 'relative',
                                overflow: 'hidden'
                            }}
                            transition={springTransition}
                        >
                            {/* Decorative glow */}
                            <div style={{
                                position: 'absolute',
                                top: -20,
                                right: -20,
                                width: 100,
                                height: 100,
                                background: 'var(--brand-primary)',
                                filter: 'blur(50px)',
                                opacity: 0.08,
                                pointerEvents: 'none'
                            }} />

                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                                <div className="widget-label" style={{ margin: 0 }}>
                                    <div style={{ width: 22, height: 22, borderRadius: 6, background: 'rgba(99, 102, 241, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--brand-primary)', marginRight: 8 }}>
                                        <Mail size={12} strokeWidth={2.5} />
                                    </div>
                                    Active Identity
                                </div>
                                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <AnimatePresence mode="wait">
                                        <motion.div
                                            key={checking || syncing ? 'syncing' : 'updated'}
                                            initial={{ opacity: 0, y: 5 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: -5 }}
                                            style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                                        >
                                            <RefreshCw size={10} className={checking || syncing ? 'spin' : ''} />
                                            {checking || syncing ? 'Syncing...' : `Updated ${formatRelativeTime(lastUpdated)}`}
                                        </motion.div>
                                    </AnimatePresence>
                                </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    {/* Email Display - Terminal Style */}
                                    <div
                                        style={{
                                            fontSize: 20,
                                            fontWeight: 700,
                                            letterSpacing: '-0.5px',
                                            color: 'var(--text-primary)',
                                            marginBottom: 2,
                                            fontFamily: 'var(--font-mono)'
                                        }}
                                        className="truncate"
                                    >
                                        {emailAccount.fullEmail.split('@')[0]}
                                    </div>
                                    <div
                                        style={{
                                            fontSize: 13,
                                            fontWeight: 500,
                                            color: 'var(--text-secondary)',
                                            fontFamily: 'var(--font-mono)',
                                        }}
                                    >
                                        @{emailAccount.fullEmail.split('@')[1]}
                                    </div>

                                    {/* Status Badges */}
                                    <div style={{ display: 'flex', gap: 12, marginTop: 10, alignItems: 'center' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--success)', fontWeight: 600 }}>
                                            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)' }} />
                                            Temporary
                                        </div>
                                        {timeLeft && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: timeLeft === 'Expired' ? 'var(--error)' : 'var(--warning)', fontWeight: 600 }}>
                                                <Clock size={10} strokeWidth={2.5} />
                                                {timeLeft}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <motion.button
                                    className="back-button"
                                    onClick={copyEmail}
                                    style={{
                                        width: 44, height: 44,
                                        background: copied ? 'var(--badge-success)' : 'var(--list-item-bg)',
                                        color: copied ? 'var(--success)' : 'var(--text-primary)',
                                        borderRadius: '50%',
                                        flexShrink: 0
                                    }}
                                    whileTap={{ scale: 0.9 }}
                                    aria-label="Copy email to clipboard"
                                >
                                    {copied ? <Check size={20} strokeWidth={2.5} /> : <Copy size={20} strokeWidth={2} />}
                                </motion.button>
                            </div>
                            {/* Action Buttons */}
                            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                                <button
                                    className="ios-button button-secondary"
                                    onClick={onGenerate}
                                    style={{ flex: 1 }}
                                >
                                    <RefreshCw size={16} />
                                    New Email
                                </button>
                                <button
                                    className="ios-button button-primary"
                                    onClick={() => checkInbox()}
                                    disabled={checking}
                                    style={{ flex: 1 }}
                                >
                                    <Inbox size={16} />
                                    {checking ? 'Syncing...' : 'Sync Inbox'}
                                </button>
                            </div>
                        </motion.div>
                    )}

                    {/* Inbox Section */}
                    <div style={{ marginTop: variant === 'inbox' ? 0 : 24, flex: variant === 'inbox' ? 1 : 'none', display: 'flex', flexDirection: 'column' }}>
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
                                        {/* Back Button */}
                                        {/* Back Button - Circular for Navigation */}
                                        <motion.button
                                            className="action-icon"
                                            onClick={onBack}
                                            whileTap={{ scale: 0.85 }}
                                            title="Go back"
                                            style={{
                                                marginRight: 8,
                                                borderRadius: '50%', // Circular as requested
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
                                <div className="inbox-list" style={{ flex: 1, overflowY: 'auto', marginTop: 12 }}>
                                    {inbox.length > 0 ? (
                                        inbox.map((item, i) => {
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
                                                            <span className="inbox-item-date">{formatRelativeTime(item.date)}</span>
                                                        </div>
                                                        <div className="inbox-item-subject">{item.subject}</div>
                                                        
                                                        {/* Capsule Badges for OTP and Links */}
                                                        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                                                            {verificationCode && (
                                                                <motion.button
                                                                    className="otp-badge"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        navigator.clipboard.writeText(verificationCode);
                                                                        onToast(`Code ${verificationCode} copied`);
                                                                    }}
                                                                    whileHover={{ scale: 1.05 }}
                                                                    whileTap={{ scale: 0.95 }}
                                                                    style={{
                                                                        background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(16, 185, 129, 0.1) 100%)',
                                                                        border: '1px solid rgba(16, 185, 129, 0.3)',
                                                                        color: '#10b981',
                                                                    }}
                                                                >
                                                                    <span className="otp-badge-code">🔢 {verificationCode}</span>
                                                                    <Copy size={10} />
                                                                </motion.button>
                                                            )}
                                                            {activationLink && (
                                                                <motion.button
                                                                    className="otp-badge"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        window.open(activationLink, '_blank', 'noopener,noreferrer');
                                                                        onToast('Opening activation link...');
                                                                    }}
                                                                    whileHover={{ scale: 1.05 }}
                                                                    whileTap={{ scale: 0.95 }}
                                                                    style={{
                                                                        background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(139, 92, 246, 0.1) 100%)',
                                                                        border: '1px solid rgba(99, 102, 241, 0.3)',
                                                                        color: '#6366f1',
                                                                    }}
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
                                        <div className="inbox-empty">
                                            <div style={{
                                                width: 56,
                                                height: 56,
                                                borderRadius: 18,
                                                background: 'rgba(99, 102, 241, 0.08)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                marginBottom: 12,
                                                border: '1px solid rgba(99, 102, 241, 0.12)'
                                            }}>
                                                <Mail size={26} color="var(--brand-primary)" strokeWidth={1.5} style={{ opacity: 0.7 }} />
                                            </div>
                                            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>No messages yet</span>
                                            <span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4, textAlign: 'center', maxWidth: 200 }}>
                                                Emails sent to your ghost address will appear here
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </motion.div>
                        ) : (
                            <>
                                <div className="widget-label" style={{ marginBottom: 12, paddingLeft: 4 }}>
                                    <Inbox size={14} className="sf-icon" />
                                    Secure Inbox
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    {inbox.length > 0 ? (
                                        inbox.map((item, i) => {
                                            // Use shared utility functions
                                            const verificationCode = extractOTP(item.subject + ' ' + (item.body || ''));
                                            const activationLink = extractActivationLink(item.body || '');

                                            return (
                                                <motion.div
                                                    key={item.id}
                                                    initial={{ opacity: 0, y: 10 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    transition={{ delay: i * 0.05, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                                                    className="glass-card"
                                                    style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, background: 'var(--list-item-bg)' }}
                                                >
                                                    {/* Avatar */}
                                                    <div style={{
                                                        width: 40,
                                                        height: 40,
                                                        borderRadius: 12,
                                                        background: 'var(--brand-gradient)',
                                                        color: 'white',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        fontWeight: 700,
                                                        fontSize: 16,
                                                        boxShadow: 'var(--shadow-brand)',
                                                        flexShrink: 0
                                                    }}>
                                                        {item.from.charAt(0).toUpperCase()}
                                                    </div>

                                                    {/* Content */}
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }} className="truncate">{item.from}</div>
                                                            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 500 }}>{formatRelativeTime(item.date)}</div>
                                                        </div>
                                                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500, marginTop: 2 }} className="truncate">{item.subject}</div>

                                                        {/* Capsule Badges */}
                                                        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                                                            {verificationCode && (
                                                                <motion.button
                                                                    style={{
                                                                        padding: '4px 10px',
                                                                        background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(16, 185, 129, 0.1) 100%)',
                                                                        border: '1px solid rgba(16, 185, 129, 0.3)',
                                                                        borderRadius: 6,
                                                                        color: '#10b981',
                                                                        fontSize: 12,
                                                                        fontWeight: 700,
                                                                        fontFamily: 'var(--font-mono)',
                                                                        cursor: 'pointer',
                                                                        display: 'inline-flex',
                                                                        alignItems: 'center',
                                                                        gap: 4
                                                                    }}
                                                                    onClick={async (e) => {
                                                                        e.stopPropagation();
                                                                        await navigator.clipboard.writeText(verificationCode);
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
                                                                    style={{
                                                                        padding: '4px 10px',
                                                                        background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(139, 92, 246, 0.1) 100%)',
                                                                        border: '1px solid rgba(99, 102, 241, 0.3)',
                                                                        borderRadius: 6,
                                                                        color: '#6366f1',
                                                                        fontSize: 12,
                                                                        fontWeight: 600,
                                                                        cursor: 'pointer',
                                                                        display: 'inline-flex',
                                                                        alignItems: 'center',
                                                                        gap: 4
                                                                    }}
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
                                        <div style={{
                                            flex: 1,
                                            padding: '40px 20px',
                                            textAlign: 'center',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            minHeight: 160
                                        }}>
                                            <motion.div
                                                initial={{ opacity: 0, scale: 0.95 }}
                                                animate={{ opacity: 1, scale: 1 }}
                                                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}
                                            >
                                                <div style={{
                                                    width: 64,
                                                    height: 64,
                                                    borderRadius: 20,
                                                    background: 'var(--list-item-bg)',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    marginBottom: 16
                                                }}>
                                                    <Inbox size={28} color="var(--brand-primary)" strokeWidth={1.5} style={{ opacity: 0.6 }} />
                                                </div>
                                                <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>Inbox is Empty</div>
                                                <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 6, maxWidth: 200, lineHeight: 1.5 }}>
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
                <div style={{ padding: '50px 32px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ width: 72, height: 72, borderRadius: 20, background: 'rgba(99, 102, 241, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
                        <Mail size={32} color="var(--brand-primary)" strokeWidth={1.5} />
                    </div>
                    <h2 style={{ fontSize: 20, fontWeight: 700 }}>Identity Required</h2>
                    <p style={{ color: 'var(--text-secondary)', marginTop: 10, lineHeight: 1.5, fontSize: 14 }}>Generate a secure ghost identity to access your encrypted inbox.</p>
                    <button className="ios-button button-primary" style={{ width: '100%', marginTop: 24, height: 48 }} onClick={onGenerate}>
                        <Sparkles size={16} />
                        Generate Identity
                    </button>
                </div>
            )}
        </div>
    );
};

export default EmailGenerator;
