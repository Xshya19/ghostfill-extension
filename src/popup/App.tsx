import { motion, AnimatePresence, Transition, MotionConfig } from 'framer-motion';
import { ChevronLeft, Sparkles, Mail, Zap, ShieldCheck } from 'lucide-react';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { storageService } from '../services/storageService';
import { EmailAccount } from '../types';
import { withTimeout, withRetry } from '../utils/helpers';
import { createLogger } from '../utils/logger';
import { safeSendMessage } from '../utils/messaging';
import AliasPanel from './components/AliasPanel';
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

const SPRING_TRANSITION: Transition = {
  type: 'spring',
  stiffness: 200,
  damping: 28,
  mass: 0.9,
};

type AppView = 'hub' | 'email' | 'password' | 'otp' | 'aliases';
type AliasPanelTab = 'generator' | 'inbox' | 'history';

const App: React.FC = () => {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const loading = useAppStore((s) => s.loading);
  const setLoading = useAppStore((s) => s.setLoading);
  const toast = useAppStore((s) => s.toast);
  const setToast = useAppStore((s) => s.setToast);
  const isFirstTime = useAppStore((s) => s.isFirstTime);
  const setIsFirstTime = useAppStore((s) => s.setIsFirstTime);
  const emailAccount = useAppStore((s) => s.emailAccount);
  const setEmailAccount = useAppStore((s) => s.setEmailAccount);

  // Gmail / Alias store hooks
  const setGmailConnected = useAppStore((s) => s.setGmailConnected);
  const setGmailProfile = useAppStore((s) => s.setGmailProfile);
  const setGmailBase = useAppStore((s) => s.setGmailBase);
  const setGmailIsManual = useAppStore((s) => s.setGmailIsManual);
  const setPreferredEmailType = useAppStore((s) => s.setPreferredEmailType);
  const setAliasHistory = useAppStore((s) => s.setAliasHistory);
  const setGmailInbox = useAppStore((s) => s.setGmailInbox);

  const [isInitialized, setIsInitialized] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [aliasInitialTab, setAliasInitialTab] = useState<AliasPanelTab>('generator');
  const helpTriggerRef = useRef<HTMLElement | null>(null);

  // Track toast timeout to prevent race conditions
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup toast timeout on unmount
  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

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

  const safeSetView = useCallback(
    (newView: AppView, options?: { aliasTab?: AliasPanelTab }) => {
      if (options?.aliasTab) {
        setAliasInitialTab(options.aliasTab);
      } else if (newView === 'aliases') {
        setAliasInitialTab('generator');
      }
      if (newView === 'email' && !emailAccount) {
        setView('hub');
        return;
      }
      setView(newView);
    },
    [setView, emailAccount]
  );

  const generateIdentity = useCallback(async () => {
    if (!navigator.onLine) {
      log.warn('Attempted to generate identity while offline');
      showToast('You are offline. Please connect to the internet to generate an identity.');
      return;
    }

    setLoading(true);
    try {
      log.info('Generating new identity...');
      const res = await withTimeout(
        withRetry(() => safeSendMessage({ action: 'GENERATE_EMAIL' }), 2, 1000),
        20000 // 20 second absolute timeout
      );
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
      } else {
        showToast(t('generationFailed'));
      }
    } catch (e: unknown) {
      log.error('Exception during identity generation:', e);
      if ((e as any)?.message === 'Timeout') {
        showToast('Server took too long. Try again.');
      } else {
        showToast(t('generationFailed'));
      }
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

        // Hydrate Gmail-related state from storageService
        try {
          const [
            storedConnected,
            storedProfile,
            storedBase,
            storedIsManual,
            storedPreferredType,
            storedHistory,
            storedGmailInbox,
          ] = await Promise.all([
            storageService.get('gmailConnected'),
            storageService.get('gmailProfile'),
            storageService.get('gmailBase'),
            storageService.get('gmailIsManual'),
            storageService.get('preferredEmailType'),
            storageService.get('aliasHistory'),
            storageService.get('gmailInbox'),
          ]);

          if (mounted) {
            if (storedConnected !== undefined) {
              setGmailConnected(Boolean(storedConnected));
            }
            if (storedProfile !== undefined) {
              setGmailProfile(storedProfile as any);
            }
            if (storedBase !== undefined) {
              setGmailBase(storedBase as string);
            }
            if (storedIsManual !== undefined) {
              setGmailIsManual(Boolean(storedIsManual));
            }
            if (storedPreferredType !== undefined) {
              setPreferredEmailType(storedPreferredType as 'disposable' | 'gmail');
            }
            if (Array.isArray(storedHistory)) {
              setAliasHistory(storedHistory);
            }
            if (Array.isArray(storedGmailInbox)) {
              setGmailInbox(storedGmailInbox);
            }
          }
        } catch (e) {
          log.warn('Failed to hydrate Gmail state from storageService', e);
        }

        try {
          const [storedDisposableEmail, storedCurrentEmail] = await Promise.all([
            storageService.get('disposableEmail'),
            storageService.get('currentEmail'),
          ]);
          const storedEmail =
            storedDisposableEmail ||
            (storedCurrentEmail?.service !== 'gmail' ? storedCurrentEmail : null);
          if (mounted) {
            if (storedEmail && typeof storedEmail === 'object' && 'fullEmail' in storedEmail) {
              setEmailAccount(storedEmail as EmailAccount);
            } else {
              setEmailAccount(null);
            }
          }
        } catch (e) {
          log.warn('Failed to sync initial email from storageService', e);
        }

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
  }, [
    setIsFirstTime,
    setEmailAccount,
    setGmailConnected,
    setGmailProfile,
    setGmailBase,
    setGmailIsManual,
    setPreferredEmailType,
    setAliasHistory,
    setGmailInbox,
  ]);

  useEffect(() => {
    let mounted = true;

    const unsubscribe = storageService.onChanged((changes) => {
      void (async () => {
        try {
          if (changes.gmailConnected) {
            const val = await storageService.get('gmailConnected');
            if (mounted) {
              setGmailConnected(Boolean(val));
            }
          }
          if (changes.gmailProfile) {
            const val = await storageService.get('gmailProfile');
            if (mounted) {
              setGmailProfile(val as any);
            }
          }
          if (changes.gmailBase) {
            const val = await storageService.get('gmailBase');
            if (mounted) {
              setGmailBase(val as string);
            }
          }
          if (changes.gmailIsManual) {
            const val = await storageService.get('gmailIsManual');
            if (mounted) {
              setGmailIsManual(Boolean(val));
            }
          }
          if (changes.preferredEmailType) {
            const val = await storageService.get('preferredEmailType');
            if (mounted) {
              setPreferredEmailType(val as 'disposable' | 'gmail');
            }
          }
          if (changes.aliasHistory) {
            const val = await storageService.get('aliasHistory');
            if (mounted && Array.isArray(val)) {
              setAliasHistory(val);
            }
          }
          if (changes.gmailInbox) {
            const val = await storageService.get('gmailInbox');
            if (mounted) {
              setGmailInbox(Array.isArray(val) ? val : []);
            }
          }
          if (changes.disposableEmail || changes.currentEmail) {
            const [storedDisposableEmail, storedCurrentEmail] = await Promise.all([
              storageService.get('disposableEmail'),
              storageService.get('currentEmail'),
            ]);
            const storedEmail =
              storedDisposableEmail ||
              (storedCurrentEmail?.service !== 'gmail' ? storedCurrentEmail : null);
            if (mounted) {
              if (storedEmail && typeof storedEmail === 'object' && 'fullEmail' in storedEmail) {
                setEmailAccount(storedEmail as EmailAccount);
              } else {
                setEmailAccount(null);
              }
            }
          }
        } catch (err) {
          log.warn('Error in storage sync listener', err);
        }
      })();
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [
    setGmailConnected,
    setGmailProfile,
    setGmailBase,
    setGmailIsManual,
    setPreferredEmailType,
    setAliasHistory,
    setGmailInbox,
    setEmailAccount,
  ]);

  // Route guard effect
  useEffect(() => {
    if (isInitialized && view === 'email' && !emailAccount) {
      setView('hub');
    }
  }, [isInitialized, view, emailAccount, setView]);

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

  return (
    <div className="app">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <main className="main-content-area" id="main-content" role="main">
        <AnimatePresence>
          {toast && (
            <motion.div
              className="ios-toast"
              role="status"
              aria-live="polite"
              aria-atomic="true"
              initial="hidden"
              animate="visible"
              exit="hidden"
              variants={{
                hidden: { opacity: 0, scale: 0.95, y: 20, x: '-50%' },
                visible: { opacity: 1, scale: 1, y: 0, x: '-50%' },
              }}
              transition={SPRING_TRANSITION}
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
              transition={SPRING_TRANSITION}
              className="onboarding-overlay"
            >
              <motion.div
                initial={{ scale: 0.5, opacity: 0, rotate: -20 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 200, damping: 20, delay: 0.05 }}
                className="onboarding-logo"
              >
                <Sparkles size={36} color="white" strokeWidth={2.5} />
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
                  {
                    icon: <Mail size={24} color="var(--gf-cyan)" />,
                    text: t('onboardingFeature1'),
                    sub: t('onboardingFeature1Sub'),
                  },
                  {
                    icon: <Zap size={24} color="var(--gf-yellow)" />,
                    text: t('onboardingFeature2'),
                    sub: t('onboardingFeature2Sub'),
                  },
                  {
                    icon: <ShieldCheck size={24} color="var(--gf-mint)" />,
                    text: t('onboardingFeature3'),
                    sub: t('onboardingFeature3Sub'),
                  },
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
                whileHover={{ x: -1, y: -1 }}
                whileTap={{ x: 1, y: 1 }}
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
              initial={{ opacity: 0, scale: 0.98, x: -16 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 1.02, x: 16 }}
              transition={SPRING_TRANSITION}
              className="app-view-container"
            >
              <Header onOpenSettings={handleOpenSettings} onOpenHelp={handleOpenHelp} />
              <Hub
                onNavigate={safeSetView}
                emailAccount={emailAccount}
                onGenerate={triggerGenerateIdentity}
                onToast={showToast}
              />
            </motion.div>
          )}
          {isInitialized && !isFirstTime && view === 'email' && emailAccount && (
            <motion.div
              key="email-view"
              initial={{ opacity: 0, scale: 0.98, x: 16 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 1.02, x: -16 }}
              transition={SPRING_TRANSITION}
              className="app-view-container"
            >
              <Header onOpenSettings={handleOpenSettings} onOpenHelp={handleOpenHelp} />
              <div className="ghost-dashboard inbox-detailed-dashboard">
                <EmailGenerator
                  emailAccount={emailAccount}
                  onGenerate={triggerGenerateIdentity}
                  syncing={loading}
                  onToast={showToast}
                  variant="inbox"
                  onBack={() => safeSetView('hub')}
                />
              </div>
            </motion.div>
          )}
          {isInitialized &&
            !isFirstTime &&
            (view === 'password' || view === 'otp' || view === 'aliases') && (
              <motion.div
                key="detail-view"
                className="detail-view app-view-container"
                initial={{ opacity: 0, scale: 1.02, x: 16 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.98, x: -16 }}
                transition={SPRING_TRANSITION}
              >
                <div className="header detail-view-header">
                  <div className="header-left detail-view-header-left">
                    <button
                      className="back-button detail-view-back-btn"
                      onClick={() => safeSetView('hub')}
                      aria-label="Go back to hub"
                    >
                      <ChevronLeft size={22} className="sf-icon" />
                    </button>
                    <span className="header-title detail-view-title">
                      {view === 'otp'
                        ? t('passcodeSync')
                        : view === 'aliases'
                          ? 'Gmail Aliases'
                          : t('vaultSettings')}
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
                  {view === 'aliases' && (
                    <AliasPanel
                      initialTab={aliasInitialTab}
                      onToast={showToast}
                      onBack={() => safeSetView('hub')}
                    />
                  )}
                </div>
              </motion.div>
            )}
        </AnimatePresence>

        <AnimatePresence>
          {showHelp && (
            <motion.div
              className="modal-overlay help-modal-overlay"
              onClick={() => setShowHelp(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.div
                className="memphis-card help-card"
                role="dialog"
                aria-modal="true"
                aria-labelledby="help-modal-title"
                onClick={(e) => e.stopPropagation()}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={SPRING_TRANSITION}
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
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
};

const AppWithErrorBoundary: React.FC = () => (
  <ErrorBoundary>
    <MotionConfig
      reducedMotion={
        typeof process !== 'undefined' && process.env?.NODE_ENV === 'production' ? 'user' : 'never'
      }
    >
      <App />
    </MotionConfig>
  </ErrorBoundary>
);

export default AppWithErrorBoundary;
