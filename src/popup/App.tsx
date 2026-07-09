import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
import { ChevronLeft } from 'lucide-react';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { storageService } from '../services/storageService';
import { Toast } from '../shared/ui';
import { springSoft, viewFade } from '../shared/ui/motion';
import { EmailAccount } from '../types';
import { withTimeout, withRetry } from '../utils/core';
import { createLogger } from '../utils/logger';
import { safeSendMessage } from '../utils/messaging';
import {
  AliasPanel,
  AppSkeleton,
  EmailGenerator,
  ErrorBoundary,
  Header,
  HelpModal,
  Hub,
  Onboarding,
  OTPDisplay,
  PasswordGenerator
} from './components';
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
        45000 // 45 second absolute timeout to allow for fallback providers
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
        <Toast message={toast} />

        <AnimatePresence>
          {!isInitialized ? (
            <AppSkeleton key="app-skeleton" />
          ) : isFirstTime ? (
            <Onboarding
              key="onboarding"
              onDismiss={dismissOnboarding}
              version={getExtensionVersion()}
            />
          ) : null}
        </AnimatePresence>

        <AnimatePresence mode="popLayout">
          {isInitialized && !isFirstTime && view === 'hub' && (
            <motion.div
              key="hub-view"
              variants={viewFade}
              initial="initial"
              animate="animate"
              exit="exit"
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
              variants={viewFade}
              initial="initial"
              animate="animate"
              exit="exit"
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
                variants={viewFade}
                initial="initial"
                animate="animate"
                exit="exit"
              >
                <div className="header detail-view-header">
                  <div
                    className="detail-view-header-left"
                    style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}
                  >
                    <button
                      className="icon-button"
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                      onClick={() => safeSetView('hub')}
                      aria-label="Go back to hub"
                    >
                      <ChevronLeft size={18} strokeWidth={2.5} />
                    </button>
                    <span
                      className="header-title"
                      style={{
                        fontSize: 15,
                        fontWeight: 700,
                        letterSpacing: '-0.02em',
                        background:
                          'linear-gradient(135deg, var(--gf-ink) 0%, rgba(var(--gf-ink-rgb), 0.75) 100%)',
                        WebkitBackgroundClip: 'text',
                        backgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        display: 'block',
                        visibility: 'visible',
                      }}
                    >
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
                    <AliasPanel initialTab={aliasInitialTab} onToast={showToast} onBack={() => safeSetView('hub')} />
                  )}
                </div>
              </motion.div>
            )}
        </AnimatePresence>

        <HelpModal open={showHelp} onClose={() => setShowHelp(false)} />
      </main>
    </div>
  );
};

const AppWithErrorBoundary: React.FC = () => (
  <ErrorBoundary>
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </ErrorBoundary>
);

export default AppWithErrorBoundary;
