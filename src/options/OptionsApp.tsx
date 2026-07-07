import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';

import { GhostLogo } from '../popup/components';
import { storageService } from '../services/storageService';
import { Button } from '../shared/ui';
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

const t = (key: string): string => {
  try {
    return chrome.i18n.getMessage(key) || key;
  } catch {
    return key;
  }
};
const _t = t;

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

  // PERMANENT FIX 2026-06-21: previously only `passwordDefaults.length`
  // was actually validated. The other three fields claimed by
  // ALL_VALIDATED_FIELDS were never checked — silently accepting
  // nonsensical values. Now they are.
  const { length } = s.passwordDefaults;
  if (length < 8) {
    errors.passwordDefaults = {
      ...errors.passwordDefaults,
      length: t('passwordLengthMin'),
    };
  } else if (length > 128) {
    errors.passwordDefaults = {
      ...errors.passwordDefaults,
      length: t('passwordLengthMax'),
    };
  }

  // checkIntervalSeconds: 3..60 integer seconds.
  if (
    !Number.isFinite(s.checkIntervalSeconds) ||
    !Number.isInteger(s.checkIntervalSeconds) ||
    s.checkIntervalSeconds < 3 ||
    s.checkIntervalSeconds > 60
  ) {
    errors.checkIntervalSeconds = t('checkIntervalRange');
  }

  // historyRetentionDays: 1..365 integer days.
  if (
    !Number.isFinite(s.historyRetentionDays) ||
    !Number.isInteger(s.historyRetentionDays) ||
    s.historyRetentionDays < 1 ||
    s.historyRetentionDays > 365
  ) {
    errors.historyRetentionDays = t('historyRetentionRange');
  }

  // customDomainUrl: optional, but if non-empty must be a valid
  // https URL pointing at the worker.
  if (s.customDomainUrl && s.customDomainUrl.trim().length > 0) {
    const trimmed = s.customDomainUrl.trim();
    try {
      const url = new URL(trimmed);
      if (url.protocol !== 'https:') {
        errors.customDomainUrl = t('customDomainHttps');
      } else if (url.hostname.length === 0) {
        errors.customDomainUrl = t('customDomainInvalid');
      }
    } catch {
      errors.customDomainUrl = t('customDomainInvalid');
    }
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
    <p>{t('loadingSettings')}</p>
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
    {t('changesSaved')}
  </div>
);

/** Accessible live region for screen readers. */
const ScreenReaderAnnouncer: React.FC<{ saved: boolean }> = ({ saved }) => (
  <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
    {saved && t('settingsSavedSuccessfully')}
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
          <Button onClick={onClose} type="button">
            {t('cancel')}
          </Button>
          <Button
            variant={modal.type === 'danger' ? 'danger' : 'primary'}
            onClick={() => {
              modal.action();
              onClose();
            }}
            type="button"
          >
            {t('confirm')}
          </Button>
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
  // PERMANENT FIX 2026-06-21: a tri-state machine replaces the
  // boolean `saved`. Previously users had no signal during the 500ms
  // auto-save debounce window that their change was in flight, and
  // there was no way to know if a save failed. The machine exposes
  // Idle / Pending / Saving / Saved / Failed in the header so the
  // user always knows what's happening.
  type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'failed';
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [loading, setLoading] = useState(true);
  const [formErrors, setFormErrors] = useState<SettingsFormErrors>({});
  const [touchedFields, setTouchedFields] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<TabId>('general');
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>(EMPTY_MODAL);
  // Ctrl+K command palette.
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

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

  const isSavingRef = useRef(false);
  const pendingSaveRef = useRef(false);

  const saveSettings = useCallback(async (settingsOverride?: UserSettings): Promise<boolean> => {
    if (isSavingRef.current) {
      pendingSaveRef.current = true;
      return false;
    }
    isSavingRef.current = true;
    try {
      const currentSettings = settingsOverride ?? settingsRef.current;
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
          setSaveState('failed');
          return false;
        }

        setSaveState('saved');
        if (savedToastTimerRef.current) {
          clearTimeout(savedToastTimerRef.current);
        }
        savedToastTimerRef.current = setTimeout(() => setSaveState('idle'), 2500);
        previousSettingsRef.current = { ...currentSettings };
        return true;
      } catch (error) {
        log.error('Failed to save settings', error);
        setSaveState('failed');
        return false;
      }
    } finally {
      isSavingRef.current = false;
      if (pendingSaveRef.current) {
        pendingSaveRef.current = false;
        setTimeout(() => void saveSettings(), 100);
      }
    }
  }, []);

  // Auto-save when settings change (skip first load)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const secretSaveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    return () => {
      if (savedToastTimerRef.current) {
        clearTimeout(savedToastTimerRef.current);
      }
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const timers = secretSaveTimersRef.current;
      for (const k in timers) {
        if (timers[k]) {
          clearTimeout(timers[k]);
        }
      }
    };
  }, []);

  useEffect(() => {
    if (isFirstLoad.current) {
      isFirstLoad.current = false;
      return;
    }
    if (!loading) {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
      // PERMANENT FIX 2026-06-21: surface the pending state immediately
      // so the user sees "Saving…" instead of nothing during the
      // 500ms debounce window. Flips back to idle/saved/failed when
      // saveSettings resolves.
      setSaveState('pending');
      autoSaveTimerRef.current = setTimeout(() => {
        setSaveState('saving');
        void saveSettings();
      }, 500);
      return () => {
        if (autoSaveTimerRef.current) {
          clearTimeout(autoSaveTimerRef.current);
        }
      };
    }
  }, [settings, loading, saveSettings]);

  // PERMANENT FIX 2026-06-21: beforeunload guard so unsaved changes
  // don't get lost if the user closes the tab during the debounce.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent): void => {
      if (saveState === 'pending' || saveState === 'saving') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [saveState]);

  // PERMANENT FIX 2026-06-21: Ctrl/Cmd+K opens a command palette that
  // jumps to any tab. Also supports Ctrl+Alt+1..7 to jump directly to
  // a tab number.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }
      if (mod && e.altKey && /^[1-7]$/.test(e.key)) {
        e.preventDefault();
        const order: TabId[] = ['general', 'email', 'password', 'automation', 'privacy', 'advanced', 'about'];
        const idx = parseInt(e.key, 10) - 1;
        const next = order[idx];
        if (next) {
          setActiveTab(next);
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

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

      if (secretSaveTimersRef.current[key]) {
        clearTimeout(secretSaveTimersRef.current[key]);
      }

      secretSaveTimersRef.current[key] = setTimeout(() => {
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
      }, 500);
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

  const handleSettingsImport = useCallback(
    (imported: UserSettings) => {
      settingsRef.current = imported;
      setSettings(imported);
      void saveSettings(imported);
    },
    [saveSettings]
  );

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
      title: t('resetSettingsTitle'),
      message: t('resetSettingsMessage'),
      type: 'warning',
      action: () => {
        settingsRef.current = DEFAULT_SETTINGS;
        setSettings(DEFAULT_SETTINGS);
        setFormErrors({});
        setTouchedFields(new Set());
        setSaveState('saving');
        // Persist immediately instead of relying on auto-save debounce
        void saveSettings(DEFAULT_SETTINGS);
        setTimeout(() => setSaveState('idle'), 2000);
      },
    });
  }, [saveSettings]);

  const handleClearData = useCallback(() => {
    setConfirmModal({
      open: true,
      title: t('clearAllDataTitle'),
      message: t('clearAllDataMessage'),
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
                title: t('errorTitle'),
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
          <div className="ghost-card logo-box logo-box--no-padding">
            <GhostLogo size={56} />
          </div>
          <div className="header-text-group">
            <h1 className="spectral-title">{t('settingsTitle')}</h1>
            <p className="spectral-subtitle">{t('settingsSubtitle')}</p>
          </div>
        </div>
      </header>

      {/* ── Dashboard ── */}
      <div
        className="dashboard-layout"
        aria-hidden={confirmModal.open ? 'true' : undefined}
        {...({ inert: confirmModal.open ? '' : undefined } as { inert?: string })}
      >
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
      <ScreenReaderAnnouncer saved={saveState === 'saved'} />

      {/* ── Toast (only when actively saved) ── */}
      {saveState === 'saved' && <SavedToast />}

      {/* ── Save state indicator (always visible while a save is in flight) ── */}
      <SaveStatusIndicator state={saveState} />

      {/* ── Ctrl+K command palette ── */}
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
      />

      {/* ── Confirmation Modal ── */}
      <ConfirmModal modal={confirmModal} onClose={closeModal} modalRef={modalRef} />
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
//  §12  S A V E   S T A T U S   I N D I C A T O R
// ═══════════════════════════════════════════════════════════════

const SaveStatusIndicator: React.FC<{ state: 'idle' | 'pending' | 'saving' | 'saved' | 'failed' }> = ({
  state,
}) => {
  if (state === 'idle') {
    return null;
  }
  let label = '';
  let cls = 'options-save-indicator ';
  switch (state) {
    case 'pending':
      label = 'Changes pending…';
      cls += 'options-save-indicator-pending';
      break;
    case 'saving':
      label = 'Saving…';
      cls += 'options-save-indicator-saving';
      break;
    case 'saved':
      label = 'Saved';
      cls += 'options-save-indicator-saved';
      break;
    case 'failed':
      label = 'Save failed — retry?';
      cls += 'options-save-indicator-failed';
      break;
  }
  return (
    <div className={cls} role="status" aria-live="polite">
      <span className="options-save-indicator-dot" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
//  §13  C O M M A N D   P A L E T T E
// ═══════════════════════════════════════════════════════════════

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: TabId;
  onSelectTab: (tab: TabId) => void;
}

const TAB_ORDER: Array<{ id: TabId; label: string; hint: string }> = [
  { id: 'general', label: 'General', hint: 'Appearance, polling, sounds' },
  { id: 'email', label: 'Email', hint: 'Service, custom domain, Gmail OAuth' },
  { id: 'password', label: 'Password', hint: 'Generator defaults' },
  { id: 'automation', label: 'Automation', hint: 'Auto-fill, shortcuts' },
  { id: 'privacy', label: 'Privacy', hint: 'Telemetry, permissions' },
  { id: 'advanced', label: 'Advanced', hint: 'Cache, debugging, danger zone' },
  { id: 'about', label: 'About', hint: 'Version, storage, tech stack' },
];

const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose, activeTab, onSelectTab }) => {
  const [query, setQuery] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setHighlightIdx(0);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightIdx((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIdx((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const target = filtered[highlightIdx];
        if (target) {
          onSelectTab(target.id);
          onClose();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, query, highlightIdx]);

  if (!isOpen) {
    return null;
  }

  const q = query.trim().toLowerCase();
  const filtered = TAB_ORDER.filter(
    (t) => !q || t.label.toLowerCase().includes(q) || t.hint.toLowerCase().includes(q)
  );

  return (
    <div
      className="command-palette-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Jump to settings section"
      onClick={onClose}
    >
      <div className="command-palette" onClick={(e) => e.stopPropagation()}>
        <input
          className="command-palette-input"
          autoFocus
          placeholder="Jump to… (try 'email' or 'privacy')"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlightIdx(0);
          }}
          aria-label="Search settings"
        />
        <ul className="command-palette-list" role="listbox">
          {filtered.length === 0 ? (
            <li className="command-palette-empty">No matches</li>
          ) : (
            filtered.map((t, idx) => (
              <li
                key={t.id}
                role="option"
                aria-selected={idx === highlightIdx}
                className={
                  idx === highlightIdx
                    ? 'command-palette-item command-palette-item-active'
                    : 'command-palette-item'
                }
                onMouseEnter={() => setHighlightIdx(idx)}
                onClick={() => {
                  onSelectTab(t.id);
                  onClose();
                }}
              >
                <span className="command-palette-item-label">{t.label}</span>
                <span className="command-palette-item-hint">{t.hint}</span>
                {t.id === activeTab && (
                  <span className="command-palette-item-badge">current</span>
                )}
              </li>
            ))
          )}
        </ul>
        <div className="command-palette-footer">
          <kbd>↑</kbd>
          <kbd>↓</kbd>
          <span>navigate</span>
          <kbd>↵</kbd>
          <span>select</span>
          <kbd>Esc</kbd>
          <span>close</span>
        </div>
      </div>
    </div>
  );
};

export default OptionsApp;
