import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';

import GhostLogo from '../popup/components/GhostLogo';
import { storageService } from '../services/storageService';
import { UserSettings, DEFAULT_SETTINGS } from '../types/storage.types';
import { createLogger } from '../utils/logger';

import Sidebar, { TabId } from './components/Sidebar';
import AboutTab from './components/tabs/AboutTab';
import AdvancedTab from './components/tabs/AdvancedTab';
import AutomationTab from './components/tabs/AutomationTab';
import EmailTab from './components/tabs/EmailTab';
import GeneralTab from './components/tabs/GeneralTab';
import PasswordTab from './components/tabs/PasswordTab';
import PrivacyTab from './components/tabs/PrivacyTab';

const log = createLogger('OptionsApp');

// ═══════════════════════════════════════════════════════════════
//  §1  T Y P E S
// ═══════════════════════════════════════════════════════════════

type SettingsFormErrors = Record<string, string> & {
  passwordDefaults?: Record<string, string>;
};

interface SessionSecretsState {
  customDomainKey: string;
  llmApiKey: string;
}

interface ConfirmModalState {
  open: boolean;
  title: string;
  message: string;
  action: () => void;
  type: 'danger' | 'warning';
}

const EMPTY_MODAL: ConfirmModalState = {
  open: false,
  title: '',
  message: '',
  action: () => {},
  type: 'warning',
};

// ═══════════════════════════════════════════════════════════════
//  §2  V A L I D A T I O N
// ═══════════════════════════════════════════════════════════════

function validateSettings(s: UserSettings): SettingsFormErrors {
  const errors: SettingsFormErrors = {};
  const { length } = s.passwordDefaults;

  if (length < 8) {
    errors.passwordDefaults = {
      ...errors.passwordDefaults,
      length: 'Password length must be at least 8',
    };
  } else if (length > 128) {
    errors.passwordDefaults = {
      ...errors.passwordDefaults,
      length: 'Password length cannot exceed 128',
    };
  }

  return errors;
}

/** All fields that should be touched on a full save attempt. */
const ALL_VALIDATED_FIELDS = new Set<string>([
  'checkIntervalSeconds',
  'historyRetentionDays',
  'passwordDefaults.length',
  'customDomainUrl',
]);

// ═══════════════════════════════════════════════════════════════
//  §3  H O O K S
// ═══════════════════════════════════════════════════════════════

/**
 * Manages the confirmation modal's focus trap and keyboard handling.
 */
function useModalFocusTrap(
  isOpen: boolean,
  modalRef: React.RefObject<HTMLDivElement | null>,
  onClose: () => void
): void {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const modal = modalRef.current;
    if (!modal) {
      return;
    }

    const focusableSelector = [
      'button:not([disabled])',
      'a[href]',
      '[tabindex]:not([tabindex="-1"])',
    ].join(', ');

    const focusableEls = modal.querySelectorAll<HTMLElement>(focusableSelector);
    const first = focusableEls[0] ?? null;
    const last = focusableEls[focusableEls.length - 1] ?? null;

    first?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key !== 'Tab') {
        return;
      }

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
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, [isOpen, modalRef, onClose]);
}

// ═══════════════════════════════════════════════════════════════
//  §4  S U B - C O M P O N E N T S
// ═══════════════════════════════════════════════════════════════

/** Full-page loading spinner shown during initial data fetch. */
const LoadingSpinner: React.FC = () => (
  <div className="loading" role="status" aria-live="polite">
    <div className="spinner" aria-hidden="true" />
    <p>Loading settings…</p>
  </div>
);

/** Ambient decorative background. */
const AmbientBackground: React.FC = () => (
  <>
    <div className="material-grain" aria-hidden="true" />
    <div className="ambient-scene" aria-hidden="true">
      <div className="blob blob-1" />
      <div className="blob blob-2" />
    </div>
  </>
);

/** Saved-state toast notification. */
const SavedToast: React.FC = () => (
  <div className="options-toast" role="alert" aria-live="assertive">
    ✓ Changes Saved
  </div>
);

/** Accessible live region for screen readers. */
const ScreenReaderAnnouncer: React.FC<{ saved: boolean }> = ({ saved }) => (
  <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
    {saved && 'Settings saved successfully'}
  </div>
);

/** Confirmation dialog with focus trap. */
const ConfirmModal: React.FC<{
  modal: ConfirmModalState;
  onClose: () => void;
  modalRef: React.RefObject<HTMLDivElement>;
}> = ({ modal, onClose, modalRef }) => {
  if (!modal.open) {
    return null;
  }

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      aria-describedby="confirm-modal-description"
    >
      <div ref={modalRef} className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3 id="confirm-modal-title">{modal.title}</h3>
        <p id="confirm-modal-description">{modal.message}</p>
        <div className="modal-actions" role="group" aria-label="Confirmation actions">
          <button className="btn btn-secondary" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className={`btn ${modal.type === 'danger' ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => {
              modal.action();
              onClose();
            }}
            type="button"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
//  §5  M A I N   O P T I O N S   A P P
// ═══════════════════════════════════════════════════════════════

const OptionsApp: React.FC = () => {
  // ── State ────────────────────────────────────────────────
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [sessionSecrets, setSessionSecrets] = useState<SessionSecretsState>({
    customDomainKey: '',
    llmApiKey: '',
  });
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [formErrors, setFormErrors] = useState<SettingsFormErrors>({});
  const [touchedFields, setTouchedFields] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<TabId>('general');
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>(EMPTY_MODAL);

  // ── Refs ─────────────────────────────────────────────────
  const isFirstLoad = useRef(true);
  const previousSettingsRef = useRef<UserSettings | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const version = useMemo(() => chrome.runtime.getManifest().version, []);

  // ═══════════════════════════════════════════════════════════
  //  §5.1  V A L I D A T I O N   H E L P E R S
  // ═══════════════════════════════════════════════════════════

  const getFieldError = useCallback(
    (field: string): string | undefined => {
      if (field.includes('.')) {
        const [parent, child] = field.split('.');
        if (parent === 'passwordDefaults' && formErrors.passwordDefaults) {
          return formErrors.passwordDefaults[child as keyof typeof formErrors.passwordDefaults];
        }
      }
      return (formErrors as Record<string, string>)[field];
    },
    [formErrors]
  );

  const fieldHasError = useCallback(
    (field: string): boolean => touchedFields.has(field) && Boolean(getFieldError(field)),
    [touchedFields, getFieldError]
  );

  const handleFieldBlur = useCallback((field: string) => {
    setTouchedFields((prev) => {
      if (prev.has(field)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(field);
      return next;
    });
  }, []);

  // ═══════════════════════════════════════════════════════════
  //  §5.2  D A T A   L O A D I N G
  // ═══════════════════════════════════════════════════════════

  const loadSettings = useCallback(async () => {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
      if (response?.settings && typeof response.settings === 'object') {
        const loaded = response.settings as UserSettings;
        setSettings(loaded);
        previousSettingsRef.current = loaded;
      }
      const customDomainKey = (await storageService.getCustomDomainKey()) || '';
      const llmApiKey = (await storageService.getLLMApiKey()) || '';
      setSessionSecrets({
        customDomainKey,
        llmApiKey,
      });
    } catch (error) {
      log.error('Failed to load settings', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  // ═══════════════════════════════════════════════════════════
  //  §5.3  S A V E
  // ═══════════════════════════════════════════════════════════

  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const saveSettings = useCallback(async (): Promise<boolean> => {
    const currentSettings = settingsRef.current;
    const errors = validateSettings(currentSettings);
    setFormErrors(errors);
    setTouchedFields(ALL_VALIDATED_FIELDS);

    if (Object.keys(errors).length > 0) {
      log.error('Validation failed', errors);
      return false;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'UPDATE_SETTINGS',
        payload: currentSettings,
      });

      if (!response || !response.success) {
        log.error('Failed to save settings: backend rejected');
        return false;
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      previousSettingsRef.current = { ...currentSettings };
      return true;
    } catch (error) {
      log.error('Failed to save settings', error);
      return false;
    }
  }, []);

  // Auto-save when settings change (skip first load)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isFirstLoad.current) {
      isFirstLoad.current = false;
      return;
    }
    if (!loading) {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
      autoSaveTimerRef.current = setTimeout(() => {
        void saveSettings();
      }, 500);
      return () => {
        if (autoSaveTimerRef.current) {
          clearTimeout(autoSaveTimerRef.current);
        }
      };
    }
  }, [settings, loading, saveSettings]);

  // ═══════════════════════════════════════════════════════════
  //  §5.4  C H A N G E   H A N D L E R S
  // ═══════════════════════════════════════════════════════════

  const handleChange = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (key: keyof UserSettings, value: any) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
      setTouchedFields((prev) => {
        if (prev.has(key as string)) {
          return prev;
        }
        const next = new Set(prev);
        next.add(key as string);
        return next;
      });
    },
    []
  );

  const handleSessionSecretChange = useCallback(
    (key: 'customDomainKey' | 'llmApiKey', value: string) => {
      setSessionSecrets((prev) => ({ ...prev, [key]: value }));
      try {
        if (key === 'customDomainKey') {
          void (value
            ? storageService.setCustomDomainKey(value)
            : storageService.clearSessionSecret(key));
        } else {
          void (value
            ? storageService.setLLMApiKey(value)
            : storageService.clearSessionSecret(key));
        }
      } catch (error) {
        log.error('Failed to set session secret', error);
      }
    },
    []
  );

  const handlePasswordDefaultChange = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (key: keyof UserSettings['passwordDefaults'], value: any) => {
      setSettings((prev) => ({
        ...prev,
        passwordDefaults: { ...prev.passwordDefaults, [key]: value },
      }));
      setTouchedFields((prev) => {
        const field = `passwordDefaults.${key}`;
        if (prev.has(field)) {
          return prev;
        }
        const next = new Set(prev);
        next.add(field);
        return next;
      });
    },
    []
  );

  const handleSettingsImport = useCallback((imported: UserSettings) => {
    setSettings(imported);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }, []);

  // ═══════════════════════════════════════════════════════════
  //  §5.5  M O D A L   &   A C T I O N S
  // ═══════════════════════════════════════════════════════════

  const closeModal = useCallback(() => {
    setConfirmModal((prev) => ({ ...prev, open: false }));
  }, []);

  useModalFocusTrap(confirmModal.open, modalRef, closeModal);

  const handleReset = useCallback(() => {
    setConfirmModal({
      open: true,
      title: 'Reset Settings?',
      message:
        'This will restore all settings to their default values. Your saved data will not be deleted.',
      type: 'warning',
      action: () => {
        setSettings(DEFAULT_SETTINGS);
        setFormErrors({});
        setTouchedFields(new Set());
        setSaved(true);
        // Persist immediately instead of relying on auto-save debounce
        void saveSettings();
        setTimeout(() => setSaved(false), 2000);
      },
    });
  }, [saveSettings]);

  const handleClearData = useCallback(() => {
    setConfirmModal({
      open: true,
      title: 'Clear All Data?',
      message:
        'This action cannot be undone. It will permanently delete all generated emails, passwords, and history.',
      type: 'danger',
      action: () => {
        void (async () => {
          await storageService.clear();
          window.location.reload();
        })();
      },
    });
  }, []);

  // ═══════════════════════════════════════════════════════════
  //  §5.6  T A B   R O U T I N G
  // ═══════════════════════════════════════════════════════════

  const activeTabContent = useMemo(() => {
    switch (activeTab) {
      case 'general':
        return <GeneralTab settings={settings} onSettingChange={handleChange} />;

      case 'email':
        return (
          <EmailTab
            settings={settings}
            onSettingChange={handleChange}
            sessionSecrets={sessionSecrets}
            onSessionSecretChange={handleSessionSecretChange}
            fieldHasError={fieldHasError}
            getFieldError={getFieldError}
            onFieldBlur={handleFieldBlur}
          />
        );

      case 'password':
        return (
          <PasswordTab
            settings={settings}
            onPasswordDefaultChange={handlePasswordDefaultChange}
            fieldHasError={fieldHasError}
            getFieldError={getFieldError}
            onFieldBlur={handleFieldBlur}
          />
        );

      case 'automation':
        return <AutomationTab settings={settings} onSettingChange={handleChange} />;

      case 'privacy':
        return (
          <PrivacyTab
            settings={settings}
            onSettingChange={handleChange}
            fieldHasError={fieldHasError}
            getFieldError={getFieldError}
            onFieldBlur={handleFieldBlur}
          />
        );

      case 'advanced':
        return (
          <AdvancedTab
            settings={settings}
            onSettingChange={handleChange}
            sessionSecrets={sessionSecrets}
            onSessionSecretChange={handleSessionSecretChange}
            onReset={handleReset}
            onClearData={handleClearData}
            onSettingsImport={handleSettingsImport}
            onError={(msg) => {
              setConfirmModal({
                open: true,
                title: 'Error',
                message: msg,
                type: 'warning',
                action: () => {},
              });
            }}
          />
        );

      case 'about':
        return <AboutTab />;

      default:
        return null;
    }
  }, [
    activeTab,
    settings,
    sessionSecrets,
    handleChange,
    handleSessionSecretChange,
    handlePasswordDefaultChange,
    handleSettingsImport,
    handleReset,
    handleClearData,
    fieldHasError,
    getFieldError,
    handleFieldBlur,
  ]);

  // ═══════════════════════════════════════════════════════════
  //  §5.7  R E N D E R
  // ═══════════════════════════════════════════════════════════

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="options-app" aria-label="GhostFill Settings">
      <AmbientBackground />

      {/* ── Header ── */}
      <header className="options-header" role="banner">
        <div className="header-content">
          <div className="ghost-card logo-box" style={{ padding: 0 }}>
            <GhostLogo size={56} />
          </div>
          <div className="header-text-group">
            <h1 className="spectral-title">GhostFill Settings</h1>
            <p className="spectral-subtitle">The Ethereal Security Experience</p>
          </div>
        </div>
      </header>

      {/* ── Dashboard ── */}
      <div className="dashboard-layout">
        <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
        <main className="options-main" role="main" id="main-content">
          {activeTabContent}
        </main>
      </div>

      {/* ── Footer ── */}
      <footer className="options-footer" role="contentinfo">
        <p>GhostFill v{version}</p>
      </footer>

      {/* ── Live Announcements ── */}
      <ScreenReaderAnnouncer saved={saved} />

      {/* ── Toast ── */}
      {saved && <SavedToast />}

      {/* ── Confirmation Modal ── */}
      <ConfirmModal modal={confirmModal} onClose={closeModal} modalRef={modalRef} />
    </div>
  );
};

export default OptionsApp;
