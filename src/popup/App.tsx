import { motion, AnimatePresence, Transition } from 'framer-motion';
import { ChevronLeft, Sparkles } from 'lucide-react';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { EmailAccount } from '../types';
import { createLogger } from '../utils/logger';
import { safeSendMessage } from '../utils/messaging';
import AppSkeleton from './components/AppSkeleton';
import EmailGenerator from './components/EmailGenerator';
import ErrorBoundary from './components/ErrorBoundary';
import Header from './components/Header';
import Hub from './components/Hub';
import OTPDisplay from './components/OTPDisplay';
import PasswordGenerator from './components/PasswordGenerator';
import { useAppStore } from './store/useAppStore';

const log = createLogger('App');

// Helper to get extension version dynamically
const getExtensionVersion = (): string => {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return 'unknown';
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
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const loading = useAppStore((s) => s.loading);
  const setLoading = useAppStore((s) => s.setLoading);
  const toast = useAppStore((s) => s.toast);
  const setToast = useAppStore((s) => s.setToast);
  const isFirstTime = useAppStore((s) => s.isFirstTime);
  const setIsFirstTime = useAppStore((s) => s.setIsFirstTime);

  const [emailAccount, setEmailAccount] = useState<EmailAccount | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const helpTriggerRef = useRef<HTMLElement | null>(null);

  // Track toast timeout to prevent race conditions
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback(
    (message: string) => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
      setToast(message);
      toastTimeoutRef.current = setTimeout(() => setToast(null), 3000);
    },
    [setToast]
  );

  useEffect(() => {
    if (!showHelp) {
      return;
    }

    const modal = document.querySelector('.help-card') as HTMLElement | null;
    if (modal) {
      const focusable = modal.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const first = focusable[0];
      first?.focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowHelp(false);
        return;
      }
      if (e.key === 'Tab' && modal) {
        const focusable = modal.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showHelp]);

  useEffect(() => {
    if (!showHelp && helpTriggerRef.current) {
      helpTriggerRef.current.focus();
    }
  }, [showHelp]);

  const handleOpenHelp = useCallback(() => {
    helpTriggerRef.current = document.activeElement as HTMLElement;
    setShowHelp(true);
  }, []);

  const refreshCurrentEmail = useCallback(async () => {
    try {
      const res = await safeSendMessage({ action: 'GET_CURRENT_EMAIL' });
      const emailObj = res && 'email' in res ? res.email : null;
      if (emailObj && typeof emailObj === 'object' && 'fullEmail' in emailObj) {
        const email = emailObj as EmailAccount;
        setEmailAccount(email);
        return email;
      }

      setEmailAccount(null);
      return null;
    } catch (e) {
      log.warn('Failed to refresh current email from background', e);
      return null;
    }
  }, [setEmailAccount]);

  const generateIdentity = useCallback(async () => {
    if (!navigator.onLine) {
      log.warn('Attempted to generate identity while offline');
      showToast('You are offline. Please connect to the internet to generate an identity.');
      return;
    }

    setLoading(true);
    try {
      log.info('Generating new identity...');
      const res = await safeSendMessage({ action: 'GENERATE_EMAIL' });
      if (
        res &&
        'email' in res &&
        res.email &&
        typeof res.email === 'object' &&
        'fullEmail' in res.email
      ) {
        const email = res.email as EmailAccount;
        setEmailAccount(email);
        showToast(t('newIdentityGenerated'));
      } else if (res && 'error' in res) {
        showToast(String(res.error));
      } else {
        showToast(t('generationFailed'));
      }
    } catch (e) {
      log.error('Exception during identity generation:', e);
      showToast(t('generationFailed'));
    } finally {
      setLoading(false);
    }
  }, [showToast, setLoading, setEmailAccount]);

  useEffect(() => {
    let mounted = true;

    const initializeApp = async () => {
      try {
        let isFirst = false;
        try {
          const result = await chrome.storage.local.get('hasSeenOnboarding');
          isFirst = !result.hasSeenOnboarding;
          if (mounted) {
            setIsFirstTime(isFirst);
          }
        } catch (e) {
          log.warn('Failed to check onboarding status', e);
          if (mounted) {
            setIsFirstTime(false);
          }
          isFirst = false;
        }

        await refreshCurrentEmail();

        // Removed aggressive auto-generation block.
        // Generates identity ONLY upon explicit user onboarding dismiss or manual generation.
      } catch (e) {
        log.error('Failed to initialize app', e);
      } finally {
        if (mounted) {
          setIsInitialized(true);
        }
      }
    };

    void initializeApp();

    return () => {
      mounted = false;
    };
  }, [refreshCurrentEmail, setIsFirstTime]);

  useEffect(() => {
    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName === 'local' && changes.currentEmail) {
        void refreshCurrentEmail();
      }
    };

    if (chrome?.storage?.onChanged) {
      chrome.storage.onChanged.addListener(listener);
    }

    return () => {
      if (chrome?.storage?.onChanged) {
        chrome.storage.onChanged.removeListener(listener);
      }
    };
  }, [refreshCurrentEmail]);

  const handleDismissOnboarding = useCallback(async () => {
    try {
      await chrome.storage.local.set({ hasSeenOnboarding: true });
      setIsFirstTime(false);
      // Auto-generate email on first dismiss so user has a working email immediately
      void generateIdentity();
    } catch (e) {
      log.warn('Failed to dismiss onboarding', e);
      setIsFirstTime(false);
      void generateIdentity();
    }
  }, [generateIdentity]);

  const handleOpenSettings = useCallback(() => {
    try {
      if (chrome.runtime.openOptionsPage) {
        void chrome.runtime.openOptionsPage();
      } else {
        window.open(chrome.runtime.getURL('options.html'));
      }
    } catch (e) {
      log.error('Failed to open settings', e);
    }
  }, []);

  const triggerGenerateIdentity = useCallback(() => {
    void generateIdentity();
  }, [generateIdentity]);

  const dismissOnboarding = handleDismissOnboarding;

  const springTransition: Transition = {
    type: 'spring',
    stiffness: 260,
    damping: 25,
    mass: 0.8,
  };

  return (
    <div className="app">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <main className="main-content-area" id="main-content" role="main">
        <div className="aurora-background" />
        <div className="noise-overlay" />

        <AnimatePresence>
          {toast && (
            <motion.div
              layout
              className="ios-toast"
              role="status"
              aria-live="polite"
              aria-atomic="true"
              initial="hidden"
              animate="visible"
              exit={{ opacity: 0, scale: 0.9, y: -20 }}
              variants={{
                hidden: { opacity: 0, scale: 0.95, y: -20, x: '-50%' },
                visible: { opacity: 1, scale: 1, y: 0, x: '-50%' },
              }}
              transition={springTransition}
            >
              {toast}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {!isInitialized ? (
            <AppSkeleton key="app-skeleton" />
          ) : isFirstTime ? (
            <motion.div
              key="onboarding"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.02 }}
              transition={springTransition}
              className="onboarding-overlay"
            >
              <motion.div
                initial={{ scale: 0.5, opacity: 0, rotate: -20 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 200, damping: 20, delay: 0.05 }}
                className="onboarding-logo"
              >
                <Sparkles size={32} color="white" strokeWidth={2.5} />
              </motion.div>

              <motion.h1
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.1 }}
                className="onboarding-title"
              >
                {t('onboardingTitle')}
              </motion.h1>

              <motion.p
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.15 }}
                className="onboarding-subtitle"
              >
                {t('onboardingSubtitle')}
              </motion.p>

              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="onboarding-features"
              >
                {[
                  { icon: '📧', text: t('onboardingFeature1'), sub: t('onboardingFeature1Sub') },
                  { icon: '⚡', text: t('onboardingFeature2'), sub: t('onboardingFeature2Sub') },
                  { icon: '🔒', text: t('onboardingFeature3'), sub: t('onboardingFeature3Sub') },
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

              <motion.button
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.3 }}
                onClick={dismissOnboarding}
                className="ios-button button-primary onboarding-btn"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {t('onboardingButton')}
              </motion.button>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="onboarding-footer"
              >
                {t('onboardingFooter')} • v{getExtensionVersion()}
              </motion.p>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <AnimatePresence mode="popLayout">
          {isInitialized && !isFirstTime && view === 'hub' && (
            <motion.div
              key="hub-view"
              layout
              initial={{ opacity: 0, scale: 0.98, x: -16 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 1.02, x: 16 }}
              transition={springTransition}
              className="app-view-container"
            >
              <Header onOpenSettings={handleOpenSettings} onOpenHelp={handleOpenHelp} />
              <Hub
                onNavigate={(v) => setView(v)}
                emailAccount={emailAccount}
                onGenerate={triggerGenerateIdentity}
                onToast={showToast}
              />
            </motion.div>
          )}
          {isInitialized && !isFirstTime && view === 'email' && (
            <motion.div
              key="email-view"
              layout
              initial={{ opacity: 0, scale: 0.98, x: 16 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 1.02, x: -16 }}
              transition={springTransition}
              className="app-view-container"
            >
              <Header onOpenSettings={handleOpenSettings} onOpenHelp={handleOpenHelp} />
              <div className="ghost-dashboard ghost-dashboard-no-top-padding">
                <EmailGenerator
                  emailAccount={emailAccount}
                  onGenerate={triggerGenerateIdentity}
                  syncing={loading}
                  onToast={showToast}
                  variant="inbox"
                  onBack={() => setView('hub')}
                />
              </div>
            </motion.div>
          )}
          {isInitialized && !isFirstTime && (view === 'password' || view === 'otp') && (
            <motion.div
              key="detail-view"
              layout
              className="detail-view app-view-container"
              initial={{ opacity: 0, scale: 1.02, x: 16 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.98, x: -16 }}
              transition={springTransition}
            >
              <div className="header detail-view-header">
                <div className="header-left detail-view-header-left">
                  <button
                    className="back-button detail-view-back-btn"
                    onClick={() => setView('hub')}
                    aria-label="Go back to hub"
                  >
                    <ChevronLeft size={20} className="sf-icon" />
                  </button>
                  <span className="header-title detail-view-title">
                    {view === 'otp' ? t('passcodeSync') : t('vaultSettings')}
                  </span>
                </div>
              </div>

              <div className="detail-content-scroll detail-view-content">
                {view === 'password' && (
                  <PasswordGenerator
                    onToast={showToast}
                    currentPassword={emailAccount?.password || ''}
                  />
                )}
                {view === 'otp' && <OTPDisplay onToast={showToast} />}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {showHelp && (
          <div className="modal-overlay help-modal-overlay" onClick={() => setShowHelp(false)}>
            <motion.div
              className="glass-card help-card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="help-modal-title"
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, y: 100 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <h2 id="help-modal-title" className="help-title">
                {t('helpTitle')}
              </h2>
              <p className="help-desc">{t('helpDescription')}</p>
              <button
                className="ios-button button-primary help-btn"
                onClick={() => setShowHelp(false)}
              >
                {t('dismiss')}
              </button>
            </motion.div>
          </div>
        )}
      </main>
    </div>
  );
};

const AppWithErrorBoundary: React.FC = () => (
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

export default AppWithErrorBoundary;
