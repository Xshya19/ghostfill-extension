import { motion } from 'framer-motion';
import { Hash, Copy, Zap, Info, ShieldCheck, Check, Inbox } from 'lucide-react';
import React, { useState, useEffect } from 'react';
import { copyToClipboard } from '../../utils/helpers';
import { safeSendMessage, safeSendTabMessage } from '../../utils/messaging';
import { useStorageSubscription } from '../hooks/useStorageSubscription';

interface Props {
    onToast: (message: string) => void;
}

const OTPDisplay: React.FC<Props> = ({ onToast }) => {
    const lastOTP = useStorageSubscription('lastOTP', null);
    const [timePercentage, setTimePercentage] = useState<number>(100);
    const [timeText, setTimeText] = useState<string>('');
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        // Immediate sync on mount
        safeSendMessage({ action: 'CHECK_INBOX' });
        // Polling removed in favor of Push-State 'lastOTP' value 
    }, []);

    useEffect(() => {
        if (lastOTP) {
            const updateTimer = () => {
                const elapsed = Date.now() - lastOTP.extractedAt;
                const total = 5 * 60 * 1000; // 5 minutes - realistic OTP expiry
                const remaining = total - elapsed;

                if (remaining <= 0) {
                    setTimePercentage(0);
                    setTimeText('Expired');
                } else {
                    setTimePercentage((remaining / total) * 100);
                    const minutes = Math.floor(remaining / 60000);
                    const seconds = Math.floor((remaining % 60000) / 1000);
                    // Format as "4m 30s" for clarity
                    setTimeText(minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`);
                }
            };

            updateTimer();
            const interval = setInterval(updateTimer, 1000);
            return () => clearInterval(interval);
        }
    }, [lastOTP]);

    const copyOTP = async () => {
        if (!lastOTP) {return;}
        try {
            await copyToClipboard(lastOTP.code);
            setCopied(true);
            onToast('OTP copied');
            setTimeout(() => setCopied(false), 2500); // Longer confirmation
        } catch (error) {
            onToast('Copy failed');
        }
    };

    const fillOTP = async () => {
        if (!lastOTP) {return;}
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab?.id) {
                const res = await safeSendTabMessage(tab.id, {
                    action: 'FILL_OTP',
                    payload: { otp: lastOTP.code, fieldSelectors: [] },
                });
                if (res) {
                    onToast('OTP filled successfully!');
                    // Don't close popup - let user verify
                } else {
                    onToast('GhostFill not found on page');
                }
            }
        } catch (error) {
            onToast('Failed to fill');
        }
    };

    return (
        <div className="generator-flow">
            <div className="glass-card" style={{ padding: 20, cursor: 'default' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                    <div className="widget-label">
                        <Hash size={14} className="sf-icon" />
                        Verification Code
                    </div>
                    <ShieldCheck size={18} color="var(--ios-success)" />
                </div>

                {lastOTP ? (
                    <div className="otp-focus-area">
                        <motion.div
                            className="otp-box"
                            onClick={copyOTP}
                            whileHover={{ y: -2, background: 'var(--list-item-hover)' }}
                            whileTap={{ scale: 0.98 }}
                        >
                            {lastOTP.code.split('').map((char: string, i: number) => (
                                <motion.span
                                    key={i}
                                    initial={{ opacity: 0, scale: 0.8, y: 5 }}
                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                    transition={{
                                        delay: i * 0.04,
                                        type: 'spring',
                                        stiffness: 300,
                                        damping: 15
                                    }}
                                    className="otp-digit"
                                >
                                    {char}
                                </motion.span>
                            ))}
                        </motion.div>

                        <div className="otp-timer-container">
                            <div className="otp-timer-bg">
                                <motion.div
                                    animate={{ width: `${timePercentage}%` }}
                                    transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
                                    className="otp-timer-fill"
                                    style={{
                                        background: timePercentage < 20 ? 'var(--error)' : 'linear-gradient(90deg, var(--brand-primary) 0%, var(--brand-secondary) 100%)',
                                        boxShadow: timePercentage < 20 ? 'none' : '0 0 10px rgba(99, 102, 241, 0.3)'
                                    }}
                                />
                            </div>
                            <div className="otp-timer-info">
                                <span className="otp-timer-label">Expiring in <span style={{ color: timePercentage < 20 ? 'var(--error)' : 'var(--text-secondary)' }}>{timeText}</span></span>
                                <span className="otp-source-label">
                                    {lastOTP.source === 'email' ? 'Real-time Sync' : 'Direct'}
                                </span>
                            </div>
                        </div>

                        <div className="otp-actions">
                            <button className="ios-button button-primary otp-action-primary" onClick={fillOTP}>
                                <Zap size={16} fill="white" />
                                Auto-Fill
                            </button>
                            <button className="ios-button button-secondary otp-action-secondary" onClick={copyOTP}>
                                {copied ? <Check size={16} color="var(--success)" /> : <Copy size={16} />}
                                {copied ? 'Copied' : 'Copy'}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="shimmer otp-empty-state">
                        {/* Animated Loading Container */}
                        <motion.div
                            className="otp-loading-container"
                            animate={{
                                scale: [1, 1.05, 1],
                                boxShadow: [
                                    '0 0 20px rgba(99, 102, 241, 0.1)',
                                    '0 0 30px rgba(99, 102, 241, 0.25)',
                                    '0 0 20px rgba(99, 102, 241, 0.1)'
                                ]
                            }}
                            transition={{
                                duration: 2,
                                repeat: Infinity,
                                ease: 'easeInOut'
                            }}
                        >
                            <motion.div
                                animate={{ rotate: 360 }}
                                transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                            >
                                <Inbox size={36} color="var(--brand-primary)" strokeWidth={1.5} />
                            </motion.div>
                        </motion.div>

                        <h3 className="otp-empty-title">
                            Listening for codes
                        </h3>
                        <p className="otp-empty-desc">
                            Verification codes from your ghost inbox will appear here instantly.
                        </p>
                    </div>
                )}
            </div>

            <div className="glass-card efficiency-tip-card">
                <div className="widget-label">
                    <Info size={14} className="sf-icon" />
                    Efficiency Tip
                </div>
                <div className="efficiency-tip-text">
                    Press <span className="kbd-key">Ctrl</span><span className="kbd-key">Shift</span><span className="kbd-key">F</span> on any page to fill the latest code instantly.
                </div>
            </div>
        </div>
    );
};

OTPDisplay.displayName = 'OTPDisplay';

export default OTPDisplay;
