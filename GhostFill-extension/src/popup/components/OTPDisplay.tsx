import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Hash, Copy, Zap, Info, ShieldCheck, Check, Loader2 } from 'lucide-react';
import { LastOTP } from '../../types';
import { safeSendMessage, safeSendTabMessage } from '../../utils/messaging';

interface Props {
    onToast: (message: string) => void;
}

const OTPDisplay: React.FC<Props> = ({ onToast }) => {
    const [lastOTP, setLastOTP] = useState<LastOTP | null>(null);
    const [timePercentage, setTimePercentage] = useState<number>(100);
    const [timeText, setTimeText] = useState<string>('');
    const [copied, setCopied] = useState(false);

    const loadLastOTP = useCallback(async () => {
        try {
            const response = await safeSendMessage({ action: 'GET_LAST_OTP' });
            if (response && 'lastOTP' in response) {
                setLastOTP(response.lastOTP || null);
            }
        } catch (error) {
            console.error('Failed to load OTP:', error);
        }
    }, []);

    useEffect(() => {
        // Immediate sync on mount
        safeSendMessage({ action: 'CHECK_INBOX' });

        loadLastOTP();
        const interval = setInterval(loadLastOTP, 2000); // Efficient: 2s polling (consistent with Hub.tsx)
        return () => clearInterval(interval);
    }, [loadLastOTP]);

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
        if (!lastOTP) return;
        try {
            await navigator.clipboard.writeText(lastOTP.code);
            setCopied(true);
            onToast('OTP copied');
            setTimeout(() => setCopied(false), 2500); // Longer confirmation
        } catch (error) {
            onToast('Copy failed');
        }
    };

    const fillOTP = async () => {
        if (!lastOTP) return;
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
                            className="glass-card"
                            style={{
                                background: 'var(--card-inner-bg)',
                                border: '1px solid rgba(255, 255, 255, 0.5)',
                                padding: '20px 16px',
                                display: 'flex',
                                flexDirection: 'row',
                                flexWrap: 'nowrap',
                                justifyContent: 'center',
                                alignItems: 'center',
                                gap: 8,
                                borderRadius: 16,
                                cursor: 'copy',
                                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.4), var(--shadow-sm)'
                            }}
                            onClick={copyOTP}
                            whileHover={{ y: -2, background: 'var(--card-inner-bg-hover)' }}
                            whileTap={{ scale: 0.98 }}
                        >
                            {lastOTP.code.split('').map((char, i) => (
                                <motion.span
                                    key={i}
                                    initial={{ opacity: 0, scale: 0.8 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    transition={{ delay: i * 0.03, type: 'spring', stiffness: 400 }}
                                    style={{
                                        fontSize: 28,
                                        fontWeight: 700,
                                        fontFamily: "'SF Mono', 'Roboto Mono', Menlo, monospace",
                                        color: 'var(--text-primary)',
                                        background: 'rgba(0, 122, 255, 0.08)',
                                        padding: '8px 10px',
                                        borderRadius: 8,
                                        minWidth: 36,
                                        textAlign: 'center',
                                    }}
                                >
                                    {char}
                                </motion.span>
                            ))}
                        </motion.div>

                        <div style={{ marginTop: 20 }}>
                            <div style={{ height: 6, width: '100%', background: 'var(--badge-bg-neutral)', borderRadius: 3, overflow: 'hidden' }}>
                                <motion.div
                                    style={{
                                        height: '100%',
                                        background: timePercentage < 20 ? 'var(--ios-error)' : 'var(--ios-accent)',
                                        width: `${timePercentage}%`
                                    }}
                                />
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 13, fontWeight: 600 }}>
                                <span style={{ color: 'var(--text-secondary)' }}>Expires in {timeText}</span>
                                <span style={{ color: 'var(--ios-accent)' }}>
                                    {lastOTP.source === 'email' ? 'Auto-Sync' : 'Manual'}
                                </span>
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
                            <button className="ios-button button-primary" style={{ flex: 1.5 }} onClick={fillOTP}>
                                <Zap size={16} fill="white" />
                                Auto-Fill
                            </button>
                            <button className="ios-button button-secondary" style={{ flex: 1 }} onClick={copyOTP}>
                                {copied ? <Check size={16} color="var(--ios-success)" /> : <Copy size={16} />}
                                {copied ? 'Copied' : 'Copy'}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div style={{ padding: '60px 0', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        {/* Animated Loading Container */}
                        <motion.div
                            style={{
                                width: 80,
                                height: 80,
                                borderRadius: 24,
                                background: 'rgba(0, 122, 255, 0.08)',
                                backdropFilter: 'blur(10px)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                marginBottom: 24,
                                boxShadow: 'inset 0 0 0 1px rgba(0, 122, 255, 0.2), 0 0 20px rgba(0, 122, 255, 0.1)'
                            }}
                            animate={{
                                scale: [1, 1.05, 1],
                                boxShadow: [
                                    '0 0 20px rgba(0, 122, 255, 0.1)',
                                    '0 0 30px rgba(0, 122, 255, 0.25)',
                                    '0 0 20px rgba(0, 122, 255, 0.1)'
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
                                <Loader2 size={36} color="var(--ios-accent)" strokeWidth={1.5} />
                            </motion.div>
                        </motion.div>

                        <h3 style={{ fontSize: 19, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.5px', marginBottom: 8 }}>
                            Checking inbox...
                        </h3>
                        <p style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 220, lineHeight: 1.6, fontWeight: 500 }}>
                            Waiting for verification code. It will appear here automatically.
                        </p>

                        {/* Pulsing dots indicator */}
                        <div style={{ display: 'flex', gap: 6, marginTop: 16 }}>
                            {[0, 1, 2].map((i) => (
                                <motion.div
                                    key={i}
                                    style={{
                                        width: 8,
                                        height: 8,
                                        borderRadius: '50%',
                                        background: 'var(--ios-accent)'
                                    }}
                                    animate={{
                                        opacity: [0.3, 1, 0.3],
                                        scale: [0.8, 1, 0.8]
                                    }}
                                    transition={{
                                        duration: 1.2,
                                        repeat: Infinity,
                                        delay: i * 0.2
                                    }}
                                />
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <div className="glass-card" style={{ marginTop: 20, padding: 16, cursor: 'default' }}>
                <div className="widget-label">
                    <Info size={14} className="sf-icon" />
                    Efficiency Tip
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8, lineHeight: 1.8 }}>
                    Press <span className="kbd-key">Ctrl</span><span className="kbd-key">Shift</span><span className="kbd-key">F</span> on any page to fill the latest code instantly.
                </div>
            </div>
        </div>
    );
};

export default OTPDisplay;
