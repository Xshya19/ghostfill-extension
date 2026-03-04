import { motion, AnimatePresence, Transition } from 'framer-motion';
import { ChevronLeft, Sparkles } from 'lucide-react';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { EmailAccount } from '../types';
import { createLogger } from '../utils/logger';
import { safeSendMessage } from '../utils/messaging';
import EmailGenerator from './components/EmailGenerator';
import ErrorBoundary from './components/ErrorBoundary';
import Header from './components/Header';
import Hub from './components/Hub';
import OTPDisplay from './components/OTPDisplay';
import PasswordGenerator from './components/PasswordGenerator';

const log = createLogger('App');

// Helper to get extension version dynamically
const getExtensionVersion = (): string => {
    try {
        return chrome.runtime.getManifest().version;
    } catch {
        return '1.0.0';
    }
};

// i18n helper
const t = (key: string): string => {
    try {
        return chrome.i18n.getMessage(key) || key;
    } catch {
        return key;
    }
};

const App: React.FC = () => {
    const [view, setView] = useState<'hub' | 'email' | 'password' | 'otp'>('hub');
    const [loading, setLoading] = useState(false);
    const [emailAccount, setEmailAccount] = useState<EmailAccount | null>(null);
    const [toast, setToast] = useState<string | null>(null);
    const [showHelp, setShowHelp] = useState(false);
    const [isFirstTime, setIsFirstTime] = useState(false);



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

    const generateIdentity = useCallback(async () => {
        if (!navigator.onLine) {
            log.warn('Attempted to generate identity while offline');
            showToast('You are offline. Please connect to the internet to generate an identity.');
            return;
        }

        setLoading(true);
        setEmailAccount(null); // Force clear to show "Generating..." and trigger re-render
        try {
            log.info('Generating new identity...');
            const res = await safeSendMessage({ action: 'GENERATE_EMAIL' });
            log.info('Generate email response:', res);

            if (res && 'email' in res && res.email && typeof res.email === 'object' && 'fullEmail' in res.email) {
                const email = res.email as EmailAccount;
                log.info('Email generated successfully:', email.fullEmail);
                // Validate the email object has required fields
                if (email && typeof email.fullEmail === 'string' && email.fullEmail.includes('@')) {
                    setEmailAccount(email);
                    showToast(t('newIdentityGenerated'));
                } else {
                    log.error('Generated email is invalid:', email);
                    showToast(t('generatedEmailInvalid'));
                }
            } else if (res && 'error' in res) {
                log.error('Generation error:', res.error);
                showToast(String(res.error) || t('generationFailed'));
            } else {
                log.error('Unexpected response format:', res);
                showToast(t('generationFailed'));
            }
        } catch (e) {
            log.error('Exception during identity generation:', e);
            showToast(t('generationFailed'));
        } finally {
            setLoading(false);
        }
    }, [showToast]);

    // Initial load
    const fetchIdentity = useCallback(async () => {
        try {
            log.info('Fetching current email...');
            const res = await safeSendMessage({ action: 'GET_CURRENT_EMAIL' });
            log.info('Fetch identity response:', res);
            if (res && 'email' in res && res.email && typeof res.email === 'object' && 'fullEmail' in res.email) {
                const email = res.email as EmailAccount;
                log.info('Current email loaded:', email.fullEmail);
                // Validate the email object has required fields
                if (email && typeof email.fullEmail === 'string' && email.fullEmail.includes('@')) {
                    setEmailAccount(email);
                } else {
                    log.error('Invalid email format:', email);
                }
            } else {
                log.debug('No current email found. Auto-generating one...');
                // Automatically generate if none is found on load
                generateIdentity();
            }
        } catch (e) {
            log.error('Failed to fetch identity', e);
        }
    }, [generateIdentity]);

    useEffect(() => {
        fetchIdentity();

        // FIX #3: Use storageService for hasSeenOnboarding check
        // NOTE: hasSeenOnboarding is intentionally NOT encrypted because:
        // 1. It's just a boolean flag for onboarding state (no sensitive data)
        // 2. It needs to be accessible before encryption is initialized
        // 3. Using chrome.storage.local directly avoids circular dependency with storageService init
        const checkFirstTime = async () => {
            try {
                const result = await chrome.storage.local.get('hasSeenOnboarding');
                setIsFirstTime(!result.hasSeenOnboarding);
            } catch (e) {
                log.warn('Failed to check onboarding status', e);
                setIsFirstTime(false);
            }
        };
        checkFirstTime();

        // FIX #4: handleStorageChange with proper type guards
        const handleStorageChange = async (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
            if (areaName === 'local' && changes.currentEmail) {
                log.info('Storage changed - currentEmail detected, re-fetching securely');
                try {
                    const decryptedEmail = await safeSendMessage({ action: 'GET_CURRENT_EMAIL' });
                    // FIX #4: Add proper type guards for safe access
                    if (decryptedEmail && typeof decryptedEmail === 'object') {
                        const response = decryptedEmail as { success?: boolean; email?: unknown };
                        if (response.success === true && response.email && typeof response.email === 'object') {
                            const email = response.email as EmailAccount;
                            // Validate email has required fields before setting
                            if (email && typeof email.fullEmail === 'string' && email.fullEmail.includes('@')) {
                                setEmailAccount(email);
                            } else {
                                log.warn('Invalid email format in storage change');
                                setEmailAccount(null);
                            }
                        } else {
                            log.warn('Invalid response format from GET_CURRENT_EMAIL');
                            setEmailAccount(null);
                        }
                    } else {
                        log.warn('Unexpected response type from GET_CURRENT_EMAIL');
                        setEmailAccount(null);
                    }
                } catch (e) {
                    log.error('Failed to re-fetch email on storage change', e);
                    setEmailAccount(null);
                }
            }
        };

        chrome.storage.onChanged.addListener(handleStorageChange);
        return () => chrome.storage.onChanged.removeListener(handleStorageChange);
    }, [fetchIdentity]);

    const handleDismissOnboarding = async () => {
        try {
            await chrome.storage.local.set({ hasSeenOnboarding: true });
            setIsFirstTime(false);
        } catch (e) {
            log.warn('Failed to dismiss onboarding', e);
            setIsFirstTime(false);
        }
    };

    // FIX #5: handleOpenSettings - opens Chrome extension management page as settings alternative
    const handleOpenSettings = useCallback(() => {
        try {
            // Open extension management page where users can access shortcuts and permissions
            chrome.tabs.create({ url: 'chrome://extensions/?shortcuts=ghostfill-extension-id' });
        } catch (e) {
            // Fallback: open extensions page without shortcuts filter
            chrome.tabs.create({ url: 'chrome://extensions/' });
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
            <a href="#main-content" className="skip-link">Skip to main content</a>
            <main className="main-content-area" id="main-content" role="main">
                {/* World-Class Background System */}
                <div className="aurora-background" />
                <div className="noise-overlay" />

                {/* Premium Toasts */}
                <AnimatePresence>
                    {toast && (
                        <motion.div
                            className="ios-toast"
                            role="status"
                            aria-live="polite"
                            aria-atomic="true"
                            initial={{ opacity: 0, scale: 0.8, y: 50 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9, y: -20 }}
                            transition={springTransition}
                            style={{
                                background: 'var(--glass-bg)',
                                backdropFilter: 'blur(20px)',
                                WebkitBackdropFilter: 'blur(20px)',
                                border: '1px solid var(--border-color)',
                                color: 'var(--text-primary)',
                                fontWeight: 600,
                                padding: '12px 24px',
                                borderRadius: '100px',
                                boxShadow: 'var(--shadow-lg)'
                            }}
                        >
                            {toast}
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Modern Onboarding Overlay - Celebrates Local Privacy */}
                <AnimatePresence>
                    {isFirstTime && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.4 }}
                            className="onboarding-overlay"
                        >
                            {/* Animated Logo */}
                            <motion.div
                                initial={{ scale: 0.5, opacity: 0, rotate: -20 }}
                                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                                transition={{ type: 'spring', damping: 15 }}
                                className="onboarding-logo"
                            >
                                <Sparkles size={32} color="white" strokeWidth={2.5} />
                            </motion.div>

                            {/* Title */}
                            <motion.h1
                                initial={{ y: 20, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                transition={{ delay: 0.1 }}
                                className="onboarding-title"
                            >
                                {t('onboardingTitle')}
                            </motion.h1>

                            {/* Subtitle */}
                            <motion.p
                                initial={{ y: 20, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                transition={{ delay: 0.15 }}
                                className="onboarding-subtitle"
                            >
                                {t('onboardingSubtitle')}
                            </motion.p>

                            {/* Feature Steps */}
                            <motion.div
                                initial={{ y: 20, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                transition={{ delay: 0.2 }}
                                className="onboarding-features"
                            >
                                {[
                                    { icon: '📧', text: t('onboardingFeature1'), sub: t('onboardingFeature1Sub') },
                                    { icon: '⚡', text: t('onboardingFeature2'), sub: t('onboardingFeature2Sub') },
                                    { icon: '🔒', text: t('onboardingFeature3'), sub: t('onboardingFeature3Sub') }
                                ].map((step, i) => (
                                    <div key={i} className="onboarding-feature-item">
                                        <span className="onboarding-feature-icon">{step.icon}</span>
                                        <div>
                                            <div className="onboarding-feature-title">{step.text}</div>
                                            <div className="onboarding-feature-sub">{step.sub}</div>
                                        </div>
                                    </div>
                                ))}
                            </motion.div>

                            {/* Get Started Button */}
                            <motion.button
                                initial={{ y: 20, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                transition={{ delay: 0.3 }}
                                onClick={handleDismissOnboarding}
                                className="ios-button button-primary onboarding-btn"
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                            >
                                {t('onboardingButton')}
                            </motion.button>

                            {/* New Footer */}
                            <motion.p
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ delay: 0.4 }}
                                className="onboarding-footer"
                            >
                                {t('onboardingFooter')} • v{getExtensionVersion()}
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
                            className="app-view-container"
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
                            className="app-view-container"
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
                            className="detail-view app-view-container"
                            initial={{ opacity: 0, scale: 1.02, x: 10 }}
                            animate={{ opacity: 1, scale: 1, x: 0 }}
                            exit={{ opacity: 0, scale: 0.98, x: -10 }}
                            transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
                        >
                            <div className="header detail-view-header">
                                <div className="header-left detail-view-header-left">
                                    <button className="back-button detail-view-back-btn" onClick={() => setView('hub')} aria-label="Go back to hub">
                                        <ChevronLeft size={20} className="sf-icon" />
                                    </button>
                                    <span className="header-title detail-view-title">
                                        {view === 'otp' ? t('passcodeSync') : t('vaultSettings')}
                                    </span>
                                </div>
                            </div>

                            <div className="detail-content-scroll detail-view-content">
                                {view === 'password' && <PasswordGenerator onToast={showToast} currentPassword={emailAccount?.password || ''} />}
                                {view === 'otp' && <OTPDisplay onToast={showToast} />}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {showHelp && (
                    <div className="modal-overlay help-modal-overlay" onClick={() => setShowHelp(false)}>
                        <motion.div
                            className="glass-card help-card"
                            onClick={(e) => e.stopPropagation()}
                            initial={{ opacity: 0, y: 100 }}
                            animate={{ opacity: 1, y: 0 }}
                        >
                            <h2 className="help-title">{t('helpTitle')}</h2>
                            <p className="help-desc">
                                {t('helpDescription')}
                            </p>
                            <button className="ios-button button-primary help-btn" onClick={() => setShowHelp(false)}>
                                {t('dismiss')}
                            </button>
                        </motion.div>
                    </div>
                )}
            </main>
        </div>
    );
};

// FIX #6: Export App wrapped in ErrorBoundary to catch async errors
// This ensures any uncaught errors in the component tree are handled gracefully
const AppWithErrorBoundary: React.FC = () => (
    <ErrorBoundary>
        <App />
    </ErrorBoundary>
);

export default AppWithErrorBoundary;
