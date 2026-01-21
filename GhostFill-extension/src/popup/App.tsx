import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence, Transition } from 'framer-motion';
import { ChevronLeft, Settings, Sparkles } from 'lucide-react';
import Hub from './components/Hub';
import Header from './components/Header';
import EmailGenerator from './components/EmailGenerator';
import PasswordGenerator from './components/PasswordGenerator';
import OTPDisplay from './components/OTPDisplay';
import { EmailAccount } from '../types';
import { safeSendMessage } from '../utils/messaging';

const App: React.FC = () => {
    const [view, setView] = useState<'hub' | 'email' | 'password' | 'otp'>('hub');
    const [loading, setLoading] = useState(false);
    const [emailAccount, setEmailAccount] = useState<EmailAccount | null>(null);
    const [toast, setToast] = useState<string | null>(null);
    const [showHelp, setShowHelp] = useState(false);
    const [needsApiKey, setNeedsApiKey] = useState(false);

    // Core layout container - Inherits dimensions from .app in CSS
    const containerStyle: React.CSSProperties = {
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        background: 'transparent',
        position: 'relative',
        overflow: 'hidden',
        minHeight: 0 // Crucial for flex box handling of child scrolling
    };

    // Track toast timeout to prevent race conditions
    const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    
    const showToast = useCallback((message: string) => {
        // Clear any existing timeout to prevent race conditions
        if (toastTimeoutRef.current) {
            clearTimeout(toastTimeoutRef.current);
        }
        setToast(message);
        toastTimeoutRef.current = setTimeout(() => setToast(null), 2500);
    }, []);

    // Initial load
    const fetchIdentity = useCallback(async () => {
        try {
            const res = await safeSendMessage({ action: 'GET_CURRENT_EMAIL' });
            if (res && 'email' in res && res.email && typeof res.email === 'object' && 'fullEmail' in res.email) {
                setEmailAccount(res.email as EmailAccount);
            }
        } catch (e) {
            console.error('Failed to fetch identity:', e);
        }
    }, []);

    const generateIdentity = async () => {
        setLoading(true);
        setEmailAccount(null); // Force clear to show "Generating..." and trigger re-render
        try {
            const res = await safeSendMessage({ action: 'GENERATE_EMAIL' });
            if (res && 'email' in res && res.email && typeof res.email === 'object' && 'fullEmail' in res.email) {
                setEmailAccount(res.email as EmailAccount);
                showToast('New identity generated!');
            }
        } catch (e) {
            showToast('Generation failed');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchIdentity();

        // Check if API key is configured
        const checkApiKey = async () => {
            try {
                const result = await chrome.storage.local.get('settings');
                const hasApiKey = result.settings?.llmApiKey && result.settings.llmApiKey.length > 10;
                setNeedsApiKey(!hasApiKey);
            } catch (e) {
                setNeedsApiKey(true);
            }
        };
        checkApiKey();

        const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
            if (areaName === 'local' && changes.currentEmail) {
                setEmailAccount(changes.currentEmail.newValue || null);
            }
            // Update API key status when settings change
            if (areaName === 'local' && changes.settings) {
                const hasApiKey = changes.settings.newValue?.llmApiKey && changes.settings.newValue.llmApiKey.length > 10;
                setNeedsApiKey(!hasApiKey);
            }
        };

        chrome.storage.onChanged.addListener(handleStorageChange);
        return () => chrome.storage.onChanged.removeListener(handleStorageChange);
    }, [fetchIdentity]);

    const handleCopyEmail = async () => {
        if (!emailAccount) return;
        try {
            await navigator.clipboard.writeText(emailAccount.fullEmail);
            showToast('Email copied!');
        } catch (error) {
            showToast('Copy failed');
        }
    };

    const handleOpenSettings = useCallback(() => {
        if (chrome.runtime.openOptionsPage) {
            chrome.runtime.openOptionsPage();
        } else {
            window.open(chrome.runtime.getURL('options.html'));
        }
    }, []);

    // iOS Spring Transition Config
    const springTransition: Transition = {
        type: "spring",
        stiffness: 260,
        damping: 26,
        mass: 1
    };

    return (
        <div className="app">
            <div style={containerStyle}>
                {/* World-Class Background System */}
                <div className="aurora-background" />
                <div className="noise-overlay" />

                {/* Premium Toasts */}
                <AnimatePresence>
                    {toast && (
                        <motion.div
                            className="ios-toast"
                            initial={{ opacity: 0, y: 50 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20, scale: 0.9 }}
                            transition={springTransition}
                        >
                            {toast}
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* MANDATORY API Key Setup Overlay - Compact Design */}
                <AnimatePresence>
                    {needsApiKey && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.3 }}
                            style={{
                                position: 'absolute',
                                inset: 0,
                                zIndex: 1000,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: '16px 20px',
                                background: 'linear-gradient(180deg, rgba(248, 250, 252, 0.99) 0%, rgba(241, 245, 249, 0.99) 100%)',
                                backdropFilter: 'blur(20px)',
                            }}
                        >
                            {/* Logo Icon - Compact */}
                            <motion.div
                                initial={{ scale: 0.5, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                transition={{ delay: 0.1, type: 'spring', stiffness: 200 }}
                                style={{
                                    width: 48,
                                    height: 48,
                                    borderRadius: '14px',
                                    background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    marginBottom: 14,
                                    boxShadow: '0 8px 24px rgba(99, 102, 241, 0.3)',
                                }}
                            >
                                <Sparkles size={24} color="white" strokeWidth={2} />
                            </motion.div>

                            {/* Title */}
                            <motion.h1
                                initial={{ y: 10, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                transition={{ delay: 0.12 }}
                                style={{
                                    fontSize: 20,
                                    fontWeight: 700,
                                    color: '#0f172a',
                                    marginBottom: 4,
                                    textAlign: 'center',
                                }}
                            >
                                Welcome to GhostFill
                            </motion.h1>

                            {/* Subtitle */}
                            <motion.p
                                initial={{ y: 10, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                transition={{ delay: 0.15 }}
                                style={{
                                    fontSize: 13,
                                    color: '#64748b',
                                    textAlign: 'center',
                                    marginBottom: 16,
                                    lineHeight: 1.4,
                                }}
                            >
                                Quick setup to unlock AI-powered autofill
                            </motion.p>

                            {/* Steps Card - Compact */}
                            <motion.div
                                initial={{ y: 15, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                transition={{ delay: 0.18 }}
                                style={{
                                    width: '100%',
                                    maxWidth: 280,
                                    background: 'white',
                                    borderRadius: '12px',
                                    padding: '14px 16px',
                                    marginBottom: 16,
                                    boxShadow: '0 2px 12px rgba(0, 0, 0, 0.05)',
                                    border: '1px solid rgba(0, 0, 0, 0.04)',
                                }}
                            >
                                {/* Step 1 */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                                    <div style={{
                                        width: 22,
                                        height: 22,
                                        borderRadius: '50%',
                                        background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                                        color: 'white',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: 11,
                                        fontWeight: 700,
                                        flexShrink: 0,
                                    }}>1</div>
                                    <div>
                                        <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>Get API Key </span>
                                        <span style={{ fontSize: 12, color: '#6366f1' }}>console.groq.com</span>
                                    </div>
                                </div>

                                {/* Step 2 */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                                    <div style={{
                                        width: 22,
                                        height: 22,
                                        borderRadius: '50%',
                                        background: 'rgba(99, 102, 241, 0.1)',
                                        color: '#6366f1',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: 11,
                                        fontWeight: 700,
                                        flexShrink: 0,
                                    }}>2</div>
                                    <span style={{ fontSize: 13, color: '#475569' }}>Create account & copy key (free)</span>
                                </div>

                                {/* Step 3 */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <div style={{
                                        width: 22,
                                        height: 22,
                                        borderRadius: '50%',
                                        background: 'rgba(99, 102, 241, 0.1)',
                                        color: '#6366f1',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: 11,
                                        fontWeight: 700,
                                        flexShrink: 0,
                                    }}>3</div>
                                    <span style={{ fontSize: 13, color: '#475569' }}>Paste in Settings → AI → API Key</span>
                                </div>
                            </motion.div>

                            {/* CTA Button */}
                            <motion.button
                                initial={{ y: 10, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                transition={{ delay: 0.22 }}
                                onClick={handleOpenSettings}
                                style={{
                                    width: '100%',
                                    maxWidth: 280,
                                    padding: '12px 24px',
                                    borderRadius: '10px',
                                    background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                                    color: 'white',
                                    fontWeight: 600,
                                    fontSize: 14,
                                    border: 'none',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: 8,
                                    boxShadow: '0 4px 16px rgba(99, 102, 241, 0.35)',
                                }}
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                            >
                                <Settings size={16} />
                                Open Settings
                            </motion.button>

                            {/* Footer */}
                            <motion.p
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ delay: 0.3 }}
                                style={{
                                    fontSize: 10,
                                    color: '#94a3b8',
                                    marginTop: 12,
                                    textAlign: 'center',
                                }}
                            >
                                Llama 3.1 8B • Free forever
                            </motion.p>
                        </motion.div>
                    )}
                </AnimatePresence>

                <AnimatePresence mode="popLayout">
                    {view === 'hub' && (
                        <motion.div
                            key="hub-view"
                            layout
                            initial={{ opacity: 0, scale: 0.98, x: -10 }}
                            animate={{ opacity: 1, scale: 1, x: 0 }}
                            exit={{ opacity: 0, scale: 1.02, x: 10 }}
                            transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                flex: 1,
                                minHeight: 0
                            }}
                        >
                            <Header
                                onOpenSettings={handleOpenSettings}
                                onOpenHelp={() => setShowHelp(true)}
                            />
                            <Hub
                                onNavigate={(v) => setView(v)}
                                emailAccount={emailAccount}
                                onGenerate={generateIdentity}
                                onToast={showToast}
                            />
                        </motion.div>
                    )}
                    {view === 'email' && (
                        <motion.div
                            key="email-view"
                            layout
                            initial={{ opacity: 0, scale: 0.98, x: 10 }}
                            animate={{ opacity: 1, scale: 1, x: 0 }}
                            exit={{ opacity: 0, scale: 1.02, x: -10 }}
                            transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                flex: 1,
                                minHeight: 0
                            }}
                        >
                            <Header
                                onOpenSettings={handleOpenSettings}
                                onOpenHelp={() => setShowHelp(true)}
                            />
                            <div className="ghost-dashboard" style={{ paddingTop: 0 }}>
                                <EmailGenerator
                                    emailAccount={emailAccount}
                                    onGenerate={generateIdentity}
                                    syncing={loading}
                                    onToast={showToast}
                                    variant="inbox"
                                    onBack={() => setView('hub')}
                                />
                            </div>
                        </motion.div>
                    )}
                    {(view === 'password' || view === 'otp') && (
                        <motion.div
                            key="detail-view"
                            layout
                            className="detail-view"
                            initial={{ opacity: 0, scale: 1.02, x: 10 }}
                            animate={{ opacity: 1, scale: 1, x: 0 }}
                            exit={{ opacity: 0, scale: 0.98, x: -10 }}
                            transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                flex: 1,
                                minHeight: 0
                            }}
                        >
                            <div className="header" style={{ padding: '24px 0 12px 0' }}>
                                <div className="header-left" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                                    <button className="back-button" onClick={() => setView('hub')} style={{ width: 32, height: 32 }} aria-label="Go back to hub">
                                        <ChevronLeft size={20} className="sf-icon" />
                                    </button>
                                    <span className="header-title" style={{ fontSize: 20 }}>
                                        {view === 'otp' ? 'Passcode Sync' : 'Vault Settings'}
                                    </span>
                                </div>
                            </div>

                            <div className="detail-content-scroll" style={{
                                flex: 1,
                                overflowY: 'auto',
                                minHeight: 0
                            }}>
                                {view === 'password' && <PasswordGenerator onToast={showToast} currentPassword={emailAccount?.password || ''} />}
                                {view === 'otp' && <OTPDisplay onToast={showToast} />}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Help Overlay */}
                {showHelp && (
                    <div className="modal-overlay" onClick={() => setShowHelp(false)} style={{ zIndex: 2000 }}>
                        <motion.div
                            className="glass-card"
                            onClick={(e) => e.stopPropagation()}
                            initial={{ opacity: 0, y: 100 }}
                            animate={{ opacity: 1, y: 0 }}
                            style={{ padding: 30, maxWidth: 320, textAlign: 'center' }}
                        >
                            <h2 style={{ fontSize: 22, marginBottom: 15 }}>GhostFill Help Center</h2>
                            <p style={{ color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.5 }}>
                                Redefining privacy with GhostFill's liquid-glass security. Generate identities, secure passwords, and track OTPs in real-time.
                            </p>
                            <button className="ios-button button-primary" style={{ width: '100%' }} onClick={() => setShowHelp(false)}>
                                Dismiss
                            </button>
                        </motion.div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default App;
